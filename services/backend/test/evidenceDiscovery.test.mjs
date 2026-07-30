import assert from "node:assert/strict";
import test from "node:test";
import { chaincodeRejection, failingLedger, repositoryStub, stubLedger, withServer } from "./harness.mjs";

test("a batch's evidence can be found without knowing the evidence ID", async () => {
  const ledger = stubLedger({
    evaluate: async () => Buffer.from(JSON.stringify({ batchId: "b1", status: "IN_TRANSIT" }))
  });

  await withServer({ ledger, temperatureRepository: repositoryStub() }, async ({ call }) => {
    const result = await call("GET", "/temperature/batches/b1/evidence");

    assert.equal(result.status, 200);
    assert.equal(result.body.length, 1);
    assert.equal(result.body[0].evidenceId, "EV-1");
    // Readings and statistics stay out of the listing: it exists to find the evidence, not to
    // stand in for verifying it.
    assert.deepEqual(Object.keys(result.body[0]).sort(), [
      "evidenceHash",
      "evidenceId",
      "fabricTransactionId",
      "readingCount",
      "submissionStatus"
    ]);
  });
});

// The listing reads off-chain rows, so it borrows the contract's read check by reading the batch
// from the ledger first rather than handing the data to anyone who asks.
test("a caller the contract refuses cannot list a batch's evidence", async () => {
  const ledger = failingLedger(
    chaincodeRejection("Only an active REGULATOR stakeholder may perform this operation.")
  );
  let listed = false;
  const temperatureRepository = repositoryStub({
    listEvidenceForBatch: async () => {
      listed = true;
      return [];
    }
  });

  await withServer({ ledger, temperatureRepository }, async ({ call }) => {
    const result = await call("GET", "/temperature/batches/b1/evidence");

    assert.equal(result.status, 400);
    assert.equal(listed, false, "the database must not be read once the contract has refused");
  });
});

test("the listing reports storage being unconfigured rather than guessing", async () => {
  await withServer({}, async ({ call }) => {
    const result = await call("GET", "/temperature/batches/b1/evidence");
    assert.equal(result.status, 503);
    assert.match(result.body.error, /storage is not configured/);
  });
});
