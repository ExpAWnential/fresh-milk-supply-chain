import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Pool, QueryResult } from "pg";
import {
  createVerdictRepository,
  type ArchivedVerdict,
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

// Event payload archived before the independent signature check runs.
const verdict: ArchivedVerdict = {
  evidenceId: "EV-B-1-a3f9",
  batchId: "B-1",
  evidenceHash: "a".repeat(64),
  complianceOutcome: "UNSAFE",
  submittedByStakeholderId: "oracle-001",
  fabricTransactionId: "tx-1",
  ledgerTimestamp: "2026-07-30T00:00:00.000Z",
  eventName: "ColdChainBreach"
};

// Complete row after the archive adds signature status and timestamps.
const archived: LedgerComplianceVerdict = {
  ...verdict,
  signatureCheck: "UNKNOWN",
  signatureCheckedAt: null
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
  signature_check: "UNKNOWN",
  signature_checked_at: null,
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

  it("upserts, because a replayed event carries the same values a second time", async () => {
    const pool = new FakePool();

    await repositoryOver(pool).recordVerdict(verdict);

    assert.match(pool.queries[0].text, /ON CONFLICT \(evidence_id\) DO UPDATE/);
  });

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

    assert.deepEqual(read, archived);
  });

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

// Signature status updates an already archived verdict.
describe("recording what the signature check found", () => {
  it("updates only the check columns, on the evidence it was given", async () => {
    const pool = new FakePool();

    await repositoryOver(pool).recordSignatureCheck("EV-B-1-a3f9", "FAILED");

    const [query] = pool.queries;
    assert.match(query.text, /UPDATE ledger_compliance_verdicts/);
    assert.match(query.text, /signature_check = \$2/);
    // Stamped by the database at the moment of the check, not carried in from the caller.
    assert.match(query.text, /signature_checked_at = now\(\)/);
    assert.match(query.text, /WHERE evidence_id = \$1/);
    assert.deepEqual(query.values, ["EV-B-1-a3f9", "FAILED"]);
  });

  it("reads back what the check recorded", async () => {
    const pool = new FakePool();
    pool.rows = [
      row({
        signature_check: "PASSED",
        signature_checked_at: new Date("2026-08-01T09:30:15.250Z")
      })
    ];

    const [read] = await repositoryOver(pool).listVerdictsForBatch("B-1");

    assert.equal(read.signatureCheck, "PASSED");
    assert.equal(read.signatureCheckedAt, "2026-08-01T09:30:15.250Z");
  });
});
