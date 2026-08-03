import assert from "node:assert/strict";
import test from "node:test";
import { refusingLedger, stubLedger, withServer } from "./harness.mjs";

const VERDICT = {
  evidenceId: "EV-1",
  batchId: "BATCH-001",
  evidenceHash: "a".repeat(64),
  complianceOutcome: "UNSAFE",
  submittedByStakeholderId: "oracle-001",
  fabricTransactionId: "tx-9",
  ledgerTimestamp: "2026-07-30T00:00:00.000Z",
  eventName: "ColdChainBreach"
};

const archiveHolding = (verdicts) => ({ listVerdictsForBatch: async () => verdicts });

test("the regulator's archive reports what the ledger decided about a batch", async () => {
  await withServer(
    { verdictRepository: archiveHolding([VERDICT]) },
    async ({ call }) => {
      const result = await call("GET", "/verdicts/batches/BATCH-001");

      assert.equal(result.status, 200);
      assert.deepEqual(result.body, [VERDICT]);
    }
  );
});

// Five of the six companies run no event listener and keep no archive. That is the design, not a
// misconfiguration, so it has to read as unavailable rather than as a fault.
test("a company that keeps no archive says so instead of failing", async () => {
  await withServer({}, async ({ call }) => {
    const result = await call("GET", "/verdicts/batches/BATCH-001");

    assert.equal(result.status, 503);
    assert.match(result.body.error, /no compliance archive/);
  });
});

// The archive is read only after the ledger has agreed the caller may see the batch, the same way
// the evidence listing works. Without that, the regulator's database would be open to anyone who
// could reach the port.
test("the batch is read off the ledger before the archive is opened", async () => {
  const ledger = stubLedger();
  await withServer({ ledger, verdictRepository: archiveHolding([VERDICT]) }, async ({ call }) => {
    await call("GET", "/verdicts/batches/BATCH-001");
  });

  assert.deepEqual(
    ledger.calls.map((entry) => [entry.kind, entry.args[2], ...entry.args.slice(3)]),
    [["evaluate", "getBatch", "BATCH-001"]]
  );
});

test("a contract refusing the batch read is passed on rather than answered from the archive", async () => {
  let opened = false;
  await withServer(
    {
      ledger: refusingLedger("Stakeholder 'retailer-001' is suspended."),
      verdictRepository: {
        listVerdictsForBatch: async () => {
          opened = true;
          return [VERDICT];
        }
      }
    },
    async ({ call }) => {
      const result = await call("GET", "/verdicts/batches/BATCH-001");

      assert.equal(result.status, 400);
      assert.match(result.body.error, /suspended/);
    }
  );

  assert.equal(opened, false, "the archive was read despite the contract refusing");
});
