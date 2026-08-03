import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Pool, QueryResult } from "pg";
import {
  createVerdictRepository,
  type LedgerComplianceVerdict
} from "../src/repositories/verdictRepository.js";

interface RecordedQuery {
  readonly text: string;
  readonly values?: readonly unknown[];
}

class FakePool {
  readonly queries: RecordedQuery[] = [];
  rows: readonly unknown[] = [];

  async query(text: string, values?: readonly unknown[]): Promise<QueryResult> {
    this.queries.push({ text, values });
    return { rows: this.rows, rowCount: this.rows.length } as QueryResult;
  }
}

const verdict: LedgerComplianceVerdict = {
  evidenceId: "EV-B-1-a3f9",
  batchId: "B-1",
  evidenceHash: "a".repeat(64),
  complianceOutcome: "UNSAFE",
  submittedByStakeholderId: "oracle-001",
  fabricTransactionId: "tx-1",
  ledgerTimestamp: "2026-07-30T00:00:00.000Z",
  eventName: "ColdChainBreach"
};

const row = (overrides: Record<string, unknown> = {}) => ({
  evidence_id: "EV-B-1-a3f9",
  batch_id: "B-1",
  evidence_hash: "a".repeat(64),
  compliance_outcome: "UNSAFE",
  submitted_by_stakeholder_id: "oracle-001",
  fabric_transaction_id: "tx-1",
  ledger_timestamp: new Date("2026-07-30T00:00:00.000Z"),
  event_name: "ColdChainBreach",
  ...overrides
});

function repositoryOver(pool: FakePool) {
  return createVerdictRepository(pool as unknown as Pool);
}

describe("recording what the ledger decided", () => {
  it("writes every field the archive keeps, in the order the statement names them", async () => {
    const pool = new FakePool();

    await repositoryOver(pool).recordVerdict(verdict);

    assert.equal(pool.queries.length, 1);
    assert.deepEqual(pool.queries[0].values, [
      "EV-B-1-a3f9",
      "B-1",
      "a".repeat(64),
      "UNSAFE",
      "oracle-001",
      "tx-1",
      "2026-07-30T00:00:00.000Z",
      "ColdChainBreach"
    ]);
  });

  // A restart replays from the last checkpoint, so the same event does arrive twice. A plain insert
  // would raise on the duplicate, and that throw would stop the listener on every restart.
  it("upserts, because a replayed event carries the same values a second time", async () => {
    const pool = new FakePool();

    await repositoryOver(pool).recordVerdict(verdict);

    assert.match(pool.queries[0].text, /ON CONFLICT \(evidence_id\) DO UPDATE/);
  });

  // The timestamp is the contract's, so replaying the chain reproduces the archive exactly rather
  // than restamping every row with the time of the replay.
  it("stores the ledger's own timestamp rather than the time of the write", async () => {
    const pool = new FakePool();

    await repositoryOver(pool).recordVerdict(verdict);

    assert.equal(pool.queries[0].values?.[6], "2026-07-30T00:00:00.000Z");
    assert.doesNotMatch(pool.queries[0].text, /now\(\)|CURRENT_TIMESTAMP/i);
  });
});

describe("reading a batch's verdicts back", () => {
  it("turns a database row into the shape the archive publishes", async () => {
    const pool = new FakePool();
    pool.rows = [row()];

    const [read] = await repositoryOver(pool).listVerdictsForBatch("B-1");

    assert.deepEqual(read, verdict);
  });

  // The column is a timestamp, so the driver hands back a Date. Letting one reach the JSON response
  // would serialise differently depending on the driver rather than as the ISO string it claims.
  it("reports the timestamp as an ISO string, not as a Date", async () => {
    const pool = new FakePool();
    pool.rows = [row({ ledger_timestamp: new Date("2026-08-01T09:30:15.250Z") })];

    const [read] = await repositoryOver(pool).listVerdictsForBatch("B-1");

    assert.equal(read.ledgerTimestamp, "2026-08-01T09:30:15.250Z");
  });

  it("asks only for the batch it was given", async () => {
    const pool = new FakePool();

    await repositoryOver(pool).listVerdictsForBatch("B-2");

    assert.deepEqual(pool.queries[0].values, ["B-2"]);
    assert.match(pool.queries[0].text, /WHERE batch_id = \$1/);
  });

  // Two verdicts on the same batch are read as a sequence, so an unordered result would show a
  // breach before the submission that caused it.
  it("orders by when the ledger recorded them", async () => {
    const pool = new FakePool();

    await repositoryOver(pool).listVerdictsForBatch("B-1");

    assert.match(pool.queries[0].text, /ORDER BY ledger_timestamp, evidence_id/);
  });

  it("reports a batch with no verdicts as empty rather than as missing", async () => {
    const pool = new FakePool();
    pool.rows = [];

    assert.deepEqual(await repositoryOver(pool).listVerdictsForBatch("B-unknown"), []);
  });

  it("returns every row, in the order the database gave them", async () => {
    const pool = new FakePool();
    pool.rows = [
      row({ evidence_id: "EV-1", event_name: "TemperatureEvidenceSubmitted", compliance_outcome: "COMPLIANT" }),
      row({ evidence_id: "EV-2" })
    ];

    const read = await repositoryOver(pool).listVerdictsForBatch("B-1");

    assert.deepEqual(
      read.map((entry) => [entry.evidenceId, entry.eventName, entry.complianceOutcome]),
      [
        ["EV-1", "TemperatureEvidenceSubmitted", "COMPLIANT"],
        ["EV-2", "ColdChainBreach", "UNSAFE"]
      ]
    );
  });
});
