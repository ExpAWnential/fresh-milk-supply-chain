import assert from "node:assert/strict";
import test from "node:test";
import { createReaderForRequest, describesMissingEvidence } from "../dist/fabric/anchoredEvidence.js";
import { chaincodeRejection } from "./harness.mjs";

const asRegulator = { header: (name) => (name === "x-demo-identity" ? "regulator" : undefined) };

function stubGateway(evaluate) {
  const state = { closed: false, calls: [] };
  const connect = async () => ({
    evaluateTransaction: async (...args) => {
      state.calls.push(args);
      return evaluate(...args);
    },
    close() {
      state.closed = true;
    }
  });
  return { state, connect };
}

const encode = (value) => Buffer.from(JSON.stringify(value));

test("the anchored hash and transaction come off the ledger as the calling identity", async () => {
  const { state, connect } = stubGateway(() =>
    encode({ evidenceHash: "a".repeat(64), submittedTxId: "tx-9" })
  );

  const anchored = await createReaderForRequest(asRegulator, connect).getAnchoredEvidence("EV-1");

  assert.deepEqual(anchored, { evidenceHash: "a".repeat(64), fabricTransactionId: "tx-9" });
  assert.deepEqual(state.calls[0].slice(1), [
    "TemperatureComplianceContract",
    "getTemperatureEvidence",
    "EV-1"
  ]);
  assert.equal(state.closed, true);
});

test("evidence the contract has never seen reads as absent", async () => {
  const { state, connect } = stubGateway(() => {
    throw chaincodeRejection("Temperature evidence 'EV-1' does not exist.");
  });

  assert.equal(
    await createReaderForRequest(asRegulator, connect).getAnchoredEvidence("EV-1"),
    undefined
  );
  assert.equal(state.closed, true);
});

// Absent evidence reads as a clean "never anchored", so anything that is not the contract saying
// so has to surface as a failure instead.
test("a refusal or an unreachable peer is raised rather than read as absent evidence", async () => {
  for (const error of [
    chaincodeRejection("Stakeholder 'farm-001' is suspended."),
    Object.assign(new Error("14 UNAVAILABLE: No connection established"), { code: 14 })
  ]) {
    const { state, connect } = stubGateway(() => {
      throw error;
    });

    await assert.rejects(
      createReaderForRequest(asRegulator, connect).getAnchoredEvidence("EV-1"),
      error
    );
    // The connection is released even on the way out.
    assert.equal(state.closed, true);
  }
});

test("an unknown identity is refused before any connection is opened", () => {
  let connected = false;
  const connect = async () => {
    connected = true;
    return { evaluateTransaction: async () => encode({}), close() {} };
  };

  assert.throws(
    () => createReaderForRequest({ header: () => "smuggler" }, connect),
    /Unknown demo identity/
  );
  assert.equal(connected, false);
});

// Only the contract saying it has no such evidence means "never anchored". Anything else that the
// reader swallows would be reported to an auditor as a clean "this was never on the ledger".
test("only the contract's own wording for absent evidence counts as missing", () => {
  assert.equal(
    describesMissingEvidence(new Error("Temperature evidence 'EV-1' does not exist.")),
    true
  );
  assert.equal(
    describesMissingEvidence({
      details: [{ message: "chaincode response 500, Temperature evidence 'EV-1' does not exist." }]
    }),
    true
  );
});

// Reading the evidence resolves the caller through the registry first, so registry failures arrive
// here wearing the same "does not exist" phrasing.
test("a broken registry entry is not reported as evidence that was never anchored", () => {
  assert.equal(describesMissingEvidence(new Error("Stakeholder 'farm-001' does not exist.")), false);
  assert.equal(describesMissingEvidence(new Error("Batch 'MILK-1' does not exist.")), false);
});

test("an unreachable peer is not reported as missing evidence", () => {
  assert.equal(describesMissingEvidence(new Error("14 UNAVAILABLE: No connection established")), false);
  assert.equal(describesMissingEvidence(undefined), false);
});
