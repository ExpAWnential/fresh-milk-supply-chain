import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Pool, PoolClient, QueryResult } from "pg";
import {
  createTemperatureRepository,
  StoredTemperatureEvidence,
  StoredTemperatureReading
} from "../src/repositories/temperatureRepository.js";

interface RecordedQuery {
  readonly text: string;
  readonly values?: readonly unknown[];
}

class FakeClient {
  readonly queries: RecordedQuery[] = [];
  released = false;
  // The upsert reports no row written when the existing evidence is already ANCHORED, which is
  // how the repository knows to leave the anchored readings alone.
  evidenceUpsertWrites = true;

  async query(text: string, values?: readonly unknown[]): Promise<QueryResult> {
    this.queries.push({ text, values });

    if (text.includes("INSERT INTO temperature_evidence")) {
      return { rows: [], rowCount: this.evidenceUpsertWrites ? 1 : 0 } as QueryResult;
    }

    return { rows: [], rowCount: 0 } as QueryResult;
  }

  release(): void {
    this.released = true;
  }
}

class FakePool {
  readonly client = new FakeClient();
  readonly queries: RecordedQuery[] = [];
  evidenceRows: readonly unknown[] = [];
  readingRows: readonly unknown[] = [];

  async connect(): Promise<FakeClient> {
    return this.client;
  }

  async query(text: string, values?: readonly unknown[]): Promise<QueryResult> {
    this.queries.push({ text, values });

    if (text.includes("FROM temperature_evidence")) {
      return { rows: this.evidenceRows, rowCount: this.evidenceRows.length } as QueryResult;
    }

    if (text.includes("FROM temperature_readings")) {
      return { rows: this.readingRows, rowCount: this.readingRows.length } as QueryResult;
    }

    return { rows: [], rowCount: 0 } as QueryResult;
  }
}

describe("temperature repository", () => {
  it("saves evidence and readings in one transaction", async () => {
    const pool = new FakePool();
    const repository = createTemperatureRepository(pool as unknown as Pool);
    const evidence = sampleEvidence();
    const readings = sampleReadings();

    await repository.saveEvidence(evidence, readings);

    assert.equal(pool.client.queries[0].text, "BEGIN");
    assert.match(pool.client.queries[1].text, /INSERT INTO temperature_evidence/);
    assert.match(pool.client.queries[2].text, /DELETE FROM temperature_readings/);
    assert.match(pool.client.queries[3].text, /INSERT INTO temperature_readings/);
    assert.match(pool.client.queries[4].text, /INSERT INTO temperature_readings/);
    assert.equal(pool.client.queries[5].text, "COMMIT");
    assert.equal(pool.client.released, true);
  });

  // The evidence ID is derived from the readings, so repeating a run that failed part way through
  // produces the same ID. Without the upsert the retry dies on the primary key and those readings
  // can never be anchored.
  it("replaces an earlier attempt rather than failing on the primary key", async () => {
    const pool = new FakePool();
    const repository = createTemperatureRepository(pool as unknown as Pool);

    await repository.saveEvidence(sampleEvidence(), sampleReadings());

    const upsert = pool.client.queries[1].text;
    assert.match(upsert, /ON CONFLICT \(evidence_id\) DO UPDATE/);
    // Anchored evidence is never rewritten: its readings are what the ledger hash covers.
    assert.match(upsert, /WHERE temperature_evidence\.submission_status <> 'ANCHORED'/);
  });

  it("leaves the readings untouched when the evidence is already anchored", async () => {
    const pool = new FakePool();
    pool.client.evidenceUpsertWrites = false;
    const repository = createTemperatureRepository(pool as unknown as Pool);

    await repository.saveEvidence(sampleEvidence(), sampleReadings());

    assert.equal(
      pool.client.queries.some((query) => /temperature_readings/.test(query.text)),
      false
    );
    assert.equal(pool.client.queries.at(-1)?.text, "COMMIT");
  });

  it("rejects evidence when readingCount does not match supplied readings", async () => {
    const pool = new FakePool();
    const repository = createTemperatureRepository(pool as unknown as Pool);

    await assert.rejects(
      () =>
        repository.saveEvidence(
          {
            ...sampleEvidence(),
            readingCount: 99
          },
          sampleReadings()
        ),
      /does not match/
    );
    assert.equal(pool.client.queries.length, 0);
  });

  it("fetches evidence and maps database rows to domain fields", async () => {
    const pool = new FakePool();
    pool.evidenceRows = [
      {
        evidence_id: "EV-001",
        batch_id: "BATCH-001",
        sensor_id: "SENSOR-001",
        evidence_hash: "abc123",
        min_celsius: "3.20",
        max_celsius: "3.60",
        reading_count: 2,
        compliance_outcome: "COMPLIANT",
        submission_status: "PENDING",
        fabric_transaction_id: null
      }
    ];
    const repository = createTemperatureRepository(pool as unknown as Pool);

    assert.deepEqual(await repository.getEvidence("EV-001"), sampleEvidence());
  });

  // The evidence ID embeds a hash of the readings, so it cannot be guessed. Listing by batch is
  // the only way to reach the evidence behind a cold-chain breach.
  it("lists a batch's evidence oldest first", async () => {
    const pool = new FakePool();
    pool.evidenceRows = [];
    const repository = createTemperatureRepository(pool as unknown as Pool);

    assert.deepEqual(await repository.listEvidenceForBatch("BATCH-001"), []);

    const [query] = pool.queries;
    assert.match(query.text, /WHERE batch_id = \$1/);
    assert.match(query.text, /ORDER BY created_at ASC, evidence_id ASC/);
    assert.deepEqual(query.values, ["BATCH-001"]);
  });

  it("fetches readings in deterministic database order", async () => {
    const pool = new FakePool();
    pool.readingRows = [
      {
        sensor_id: "SENSOR-001",
        sequence: 1,
        recorded_at: new Date("2026-07-14T08:00:00.000Z"),
        celsius: "3.20",
        signature: "c2lnbmF0dXJlLTE="
      },
      {
        sensor_id: "SENSOR-001",
        sequence: 2,
        recorded_at: "2026-07-14T08:15:00.000Z",
        celsius: "3.60",
        signature: "c2lnbmF0dXJlLTI="
      }
    ];
    const repository = createTemperatureRepository(pool as unknown as Pool);

    assert.deepEqual(await repository.getReadings("EV-001"), sampleReadings());
    assert.match(pool.queries[0].text, /ORDER BY recorded_at ASC, sensor_id ASC, reading_id ASC/);
  });

  it("updates submission status for anchored and failed evidence", async () => {
    const pool = new FakePool();
    const repository = createTemperatureRepository(pool as unknown as Pool);

    await repository.markAnchored("EV-001", "fabric-tx-001");
    await repository.markFailed("EV-002");

    assert.match(pool.queries[0].text, /submission_status = 'ANCHORED'/);
    assert.deepEqual(pool.queries[0].values, ["EV-001", "fabric-tx-001"]);
    assert.match(pool.queries[1].text, /submission_status = 'FAILED'/);
    assert.deepEqual(pool.queries[1].values, ["EV-002"]);
  });
});

function sampleEvidence(): StoredTemperatureEvidence {
  return {
    evidenceId: "EV-001",
    batchId: "BATCH-001",
    sensorId: "SENSOR-001",
    evidenceHash: "abc123",
    minCelsius: 3.2,
    maxCelsius: 3.6,
    readingCount: 2,
    complianceOutcome: "COMPLIANT",
    submissionStatus: "PENDING",
    fabricTransactionId: null
  };
}

function sampleReadings(): readonly StoredTemperatureReading[] {
  return [
    {
      sensorId: "SENSOR-001",
      sequence: 1,
      recordedAt: "2026-07-14T08:00:00.000Z",
      celsius: 3.2,
      signature: "c2lnbmF0dXJlLTE="
    },
    {
      sensorId: "SENSOR-001",
      sequence: 2,
      recordedAt: "2026-07-14T08:15:00.000Z",
      celsius: 3.6,
      signature: "c2lnbmF0dXJlLTI="
    }
  ];
}
