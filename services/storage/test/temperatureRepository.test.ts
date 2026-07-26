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

  async query(text: string, values?: readonly unknown[]): Promise<QueryResult> {
    this.queries.push({ text, values });
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
    assert.match(pool.client.queries[2].text, /INSERT INTO temperature_readings/);
    assert.match(pool.client.queries[3].text, /INSERT INTO temperature_readings/);
    assert.equal(pool.client.queries[4].text, "COMMIT");
    assert.equal(pool.client.released, true);
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
        average_celsius: "3.40",
        reading_count: 2,
        compliance_outcome: "COMPLIANT",
        submission_status: "PENDING",
        fabric_transaction_id: null
      }
    ];
    const repository = createTemperatureRepository(pool as unknown as Pool);

    assert.deepEqual(await repository.getEvidence("EV-001"), sampleEvidence());
  });

  it("fetches readings in deterministic database order", async () => {
    const pool = new FakePool();
    pool.readingRows = [
      {
        sensor_id: "SENSOR-001",
        recorded_at: new Date("2026-07-14T08:00:00.000Z"),
        celsius: "3.20"
      },
      {
        sensor_id: "SENSOR-001",
        recorded_at: "2026-07-14T08:15:00.000Z",
        celsius: "3.60"
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
    averageCelsius: 3.4,
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
      recordedAt: "2026-07-14T08:00:00.000Z",
      celsius: 3.2
    },
    {
      sensorId: "SENSOR-001",
      recordedAt: "2026-07-14T08:15:00.000Z",
      celsius: 3.6
    }
  ];
}
