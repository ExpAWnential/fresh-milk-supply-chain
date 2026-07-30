import assert from "node:assert/strict";
import test from "node:test";
import { chaincodeRejection, failingLedger, withServer } from "./harness.mjs";

// A peer that cannot be reached has not refused anything. Reporting it as a rejected transaction
// sends an operator looking for a fault in their request instead of in their network.
test("an unreachable peer is reported as a network failure, not a refusal", async () => {
  const transportErrors = [
    Object.assign(new Error("14 UNAVAILABLE: No connection established"), { code: 14 }),
    new Error("4 DEADLINE_EXCEEDED: Deadline exceeded")
  ];

  for (const error of transportErrors) {
    await withServer({ ledger: failingLedger(error) }, async ({ call }) => {
      const result = await call("GET", "/batches/b1");
      assert.equal(result.status, 502, error.message);
      assert.match(result.body.error, /could not be reached/);
      // The raw gRPC status never reaches the caller.
      assert.doesNotMatch(result.body.error, /UNAVAILABLE|DEADLINE_EXCEEDED/);
    });
  }
});

test("a defect in the backend is reported as a backend fault", async () => {
  const ledger = failingLedger(new TypeError("Cannot read properties of undefined"));

  await withServer({ ledger }, async ({ call }) => {
    const result = await call("GET", "/batches/b1");
    assert.equal(result.status, 500);
    assert.doesNotMatch(result.body.error, /undefined/);
  });
});

test("a thrown value that is not an object is not mistaken for a refusal", async () => {
  await withServer({ ledger: failingLedger("just a string") }, async ({ call }) => {
    const result = await call("GET", "/batches/b1");
    assert.equal(result.status, 502);
  });
});

// The contract's own words still come straight back, which is what makes a refusal readable.
test("a contract refusal is still reported with its own wording", async () => {
  const ledger = failingLedger(chaincodeRejection("Batch 'b1' must be IN_TRANSIT."));

  await withServer({ ledger }, async ({ call }) => {
    const result = await call("GET", "/batches/b1");
    assert.equal(result.status, 400);
    assert.equal(result.body.error, "Batch 'b1' must be IN_TRANSIT.");
  });
});
