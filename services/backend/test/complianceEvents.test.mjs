import assert from "node:assert/strict";
import test from "node:test";
import {
  applyComplianceEvent,
  consumeComplianceEvents
} from "../dist/events/complianceEvents.js";

const event = (eventName, payload) => ({
  eventName,
  payload: Buffer.from(typeof payload === "string" ? payload : JSON.stringify(payload))
});

const evidenceSubmitted = (overrides = {}) =>
  event("TemperatureEvidenceSubmitted", {
    evidenceId: "EV-1",
    batchId: "B-1",
    complianceOutcome: "UNSAFE",
    txId: "tx-9",
    ...overrides
  });

function recordingRepository(recordLedgerOutcome) {
  const calls = [];
  return {
    calls,
    repository: {
      async recordLedgerOutcome(...args) {
        calls.push(args);
        return recordLedgerOutcome ? recordLedgerOutcome(...args) : true;
      }
    }
  };
}

// The oracle stores its own reading of the range when it saves the evidence. The contract derives
// the verdict again on chain, and that is the one the database has to end up holding.
test("the contract's verdict from the event is written to the evidence row", async () => {
  const { calls, repository } = recordingRepository();

  const applied = await applyComplianceEvent(evidenceSubmitted(), repository);

  assert.equal(applied, true);
  assert.deepEqual(calls, [["EV-1", "UNSAFE", "tx-9"]]);
});

test("events the listener has no business with are left alone", async () => {
  const { calls, repository } = recordingRepository();

  for (const name of ["ColdChainBreach", "BatchCreated", "BatchDelivered"]) {
    const applied = await applyComplianceEvent(event(name, { batchId: "B-1" }), repository);
    assert.equal(applied, false, name);
  }
  assert.equal(calls.length, 0);
});

// A restart replays from the last checkpoint, so the same event arriving twice has to be safe.
test("the same event applied twice writes the same thing", async () => {
  const { calls, repository } = recordingRepository();
  await applyComplianceEvent(evidenceSubmitted(), repository);
  await applyComplianceEvent(evidenceSubmitted(), repository);

  assert.deepEqual(calls[0], calls[1]);
});

test("an event for evidence the database does not hold is reported as applying to nothing", async () => {
  const { repository } = recordingRepository(() => false);

  assert.equal(
    await applyComplianceEvent(evidenceSubmitted({ evidenceId: "EV-UNKNOWN" }), repository),
    false
  );
});

test("an event that cannot be read is skipped rather than applied", async () => {
  const { calls, repository } = recordingRepository();
  const unreadable = [
    event("TemperatureEvidenceSubmitted", "not json at all"),
    evidenceSubmitted({ complianceOutcome: "PROBABLY_FINE" }),
    evidenceSubmitted({ evidenceId: "" }),
    evidenceSubmitted({ txId: undefined })
  ];

  for (const bad of unreadable) {
    assert.equal(await applyComplianceEvent(bad, repository), false);
  }
  assert.equal(calls.length, 0);
});

test("every event in the stream is checkpointed once it has been handled", async () => {
  const { repository } = recordingRepository();
  const checkpointed = [];
  const stream = [evidenceSubmitted(), event("BatchCreated", { batchId: "B-1" })];

  await consumeComplianceEvents(stream, {
    temperatureRepository: repository,
    checkpoint: async (handled) => {
      checkpointed.push(handled.eventName);
    }
  });

  // Including the ones it ignores, otherwise the stream would never move past them.
  assert.deepEqual(checkpointed, ["TemperatureEvidenceSubmitted", "BatchCreated"]);
});

// Left uncheckpointed on purpose, so the next run sees it again rather than losing the verdict.
test("an event that fails to apply is not checkpointed and does not stop the stream", async () => {
  const { repository } = recordingRepository((evidenceId) => {
    if (evidenceId === "EV-BROKEN") {
      throw new Error("connection terminated unexpectedly");
    }
    return true;
  });
  const checkpointed = [];

  await consumeComplianceEvents(
    [evidenceSubmitted({ evidenceId: "EV-BROKEN" }), evidenceSubmitted({ evidenceId: "EV-2" })],
    {
      temperatureRepository: repository,
      checkpoint: async (handled) => {
        checkpointed.push(JSON.parse(Buffer.from(handled.payload).toString()).evidenceId);
      }
    }
  );

  assert.deepEqual(checkpointed, ["EV-2"]);
});
