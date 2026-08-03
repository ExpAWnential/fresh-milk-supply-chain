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

// Complete payload emitted by the temperature contract.
const evidenceSubmitted = (overrides = {}) =>
  event("TemperatureEvidenceSubmitted", {
    evidenceId: "EV-1",
    batchId: "B-1",
    evidenceHash: "a".repeat(64),
    complianceOutcome: "UNSAFE",
    submittedByStakeholderId: "oracle-001",
    txId: "tx-9",
    timestamp: "2026-07-30T00:00:00.000Z",
    ...overrides
  });

function recordingRepository(recordVerdict) {
  const verdicts = [];
  const signatureChecks = [];
  return {
    verdicts,
    signatureChecks,
    repository: {
      async recordVerdict(verdict) {
        verdicts.push(verdict);
        if (recordVerdict) {
          recordVerdict(verdict);
        }
      },
      async recordSignatureCheck(evidenceId, outcome) {
        signatureChecks.push({ evidenceId, outcome });
      },
      async listVerdictsForBatch() {
        return [];
      }
    }
  };
}

test("the contract's verdict is archived exactly as the event reported it", async () => {
  const { verdicts, repository } = recordingRepository();

  const applied = await applyComplianceEvent(evidenceSubmitted(), repository);

  assert.equal(applied?.evidenceId, "EV-1");
  assert.deepEqual(verdicts, [
    {
      evidenceId: "EV-1",
      batchId: "B-1",
      evidenceHash: "a".repeat(64),
      complianceOutcome: "UNSAFE",
      submittedByStakeholderId: "oracle-001",
      fabricTransactionId: "tx-9",
      ledgerTimestamp: "2026-07-30T00:00:00.000Z",
      eventName: "TemperatureEvidenceSubmitted"
    }
  ]);
});

// Unsafe evidence uses a separate event name and must still be archived.
test("a cold-chain breach verdict is archived like any other", async () => {
  const { verdicts, repository } = recordingRepository();

  const applied = await applyComplianceEvent(
    event("ColdChainBreach", {
      evidenceId: "EV-2",
      batchId: "B-1",
      evidenceHash: "b".repeat(64),
      complianceOutcome: "UNSAFE",
      statistics: { minCelsius: 1, maxCelsius: 9, readingCount: 3 },
      submittedByStakeholderId: "oracle-001",
      txId: "tx-10",
      timestamp: "2026-07-30T01:00:00.000Z"
    }),
    repository
  );

  assert.equal(applied?.evidenceId, "EV-2");
  assert.equal(verdicts[0].evidenceId, "EV-2");
  assert.equal(verdicts[0].eventName, "ColdChainBreach");
  assert.equal(verdicts[0].fabricTransactionId, "tx-10");
});

test("events the listener has no business with are left alone", async () => {
  const { verdicts, repository } = recordingRepository();

  for (const name of ["ColdChainBreachResolved", "BatchCreated", "BatchDelivered"]) {
    const applied = await applyComplianceEvent(event(name, { batchId: "B-1" }), repository);
    assert.equal(applied, undefined, name);
  }
  assert.equal(verdicts.length, 0);
});

test("the same event applied twice archives the same thing", async () => {
  const { verdicts, repository } = recordingRepository();
  await applyComplianceEvent(evidenceSubmitted(), repository);
  await applyComplianceEvent(evidenceSubmitted(), repository);

  assert.deepEqual(verdicts[0], verdicts[1]);
});

// Malformed payloads must be rejected before the archive's NOT NULL constraints.
test("an event that cannot be read is skipped rather than archived", async () => {
  const { verdicts, repository } = recordingRepository();
  const unreadable = [
    event("TemperatureEvidenceSubmitted", "not json at all"),
    event("TemperatureEvidenceSubmitted", "null"),
    evidenceSubmitted({ complianceOutcome: "PROBABLY_FINE" }),
    evidenceSubmitted({ evidenceId: "" }),
    evidenceSubmitted({ txId: undefined }),
    evidenceSubmitted({ batchId: undefined }),
    evidenceSubmitted({ evidenceHash: undefined }),
    evidenceSubmitted({ submittedByStakeholderId: undefined }),
    evidenceSubmitted({ timestamp: undefined })
  ];

  for (const bad of unreadable) {
    assert.equal(await applyComplianceEvent(bad, repository), undefined);
  }
  assert.equal(verdicts.length, 0);
});

test("every event in the stream is checkpointed once it has been handled", async () => {
  const { repository } = recordingRepository();
  const checkpointed = [];
  const stream = [evidenceSubmitted(), event("BatchCreated", { batchId: "B-1" })];

  await consumeComplianceEvents(stream, {
    verdictRepository: repository,
    checkpoint: async (handled) => {
      checkpointed.push(handled.eventName);
    }
  });

  assert.deepEqual(checkpointed, ["TemperatureEvidenceSubmitted", "BatchCreated"]);
});

test("a failed archive write stops the stream instead of checkpointing past it", async () => {
  const { repository } = recordingRepository((verdict) => {
    if (verdict.evidenceId === "EV-BROKEN") {
      throw new Error("connection terminated unexpectedly");
    }
  });
  const checkpointed = [];

  await assert.rejects(
    consumeComplianceEvents(
      [evidenceSubmitted({ evidenceId: "EV-BROKEN" }), evidenceSubmitted({ evidenceId: "EV-2" })],
      {
        verdictRepository: repository,
        checkpoint: async (handled) => {
          checkpointed.push(JSON.parse(Buffer.from(handled.payload).toString()).evidenceId);
        }
      }
    ),
    /Could not archive a TemperatureEvidenceSubmitted event/
  );

  // Leave the failed event and everything after it for restart replay.
  assert.deepEqual(checkpointed, []);
});

test("an event is checkpointed only after it has been archived", async () => {
  const order = [];
  const repository = {
    async recordSignatureCheck() {},
    async recordVerdict() {
      order.push("archived");
    },
    async listVerdictsForBatch() {
      return [];
    }
  };

  await consumeComplianceEvents([evidenceSubmitted()], {
    verdictRepository: repository,
    checkpoint: async () => {
      order.push("checkpointed");
    }
  });

  assert.deepEqual(order, ["archived", "checkpointed"]);
});

test("a forged reading is recorded and the stream carries on", async () => {
  const { verdicts, signatureChecks, repository } = recordingRepository();

  await consumeComplianceEvents(
    [
      evidenceSubmitted({ evidenceId: "EV-FORGED" }),
      evidenceSubmitted({ evidenceId: "EV-FINE" })
    ],
    {
      verdictRepository: repository,
      checkSignatures: async (evidenceId) => (evidenceId === "EV-FORGED" ? "FAILED" : "PASSED")
    }
  );

  assert.deepEqual(signatureChecks, [
    { evidenceId: "EV-FORGED", outcome: "FAILED" },
    { evidenceId: "EV-FINE", outcome: "PASSED" }
  ]);
  assert.equal(verdicts.length, 2, "the later verdict was still archived");
});

test("an unreachable oracle records UNKNOWN and still archives the verdict", async () => {
  const { verdicts, signatureChecks, repository } = recordingRepository();
  const checkpointed = [];

  await consumeComplianceEvents([evidenceSubmitted()], {
    verdictRepository: repository,
    checkSignatures: async () => {
      throw new Error("14 UNAVAILABLE: no connection established");
    },
    checkpoint: async (event) => checkpointed.push(event.eventName)
  });

  assert.deepEqual(signatureChecks, [{ evidenceId: "EV-1", outcome: "UNKNOWN" }]);
  assert.equal(verdicts.length, 1);
  assert.deepEqual(checkpointed, ["TemperatureEvidenceSubmitted"], "and the cursor still moved");
});

test("a failure recording the check does not stop the stream either", async () => {
  const { verdicts, repository } = recordingRepository();
  repository.recordSignatureCheck = async () => {
    throw new Error("connection terminated unexpectedly");
  };

  await consumeComplianceEvents(
    [evidenceSubmitted({ evidenceId: "EV-1" }), evidenceSubmitted({ evidenceId: "EV-2" })],
    { verdictRepository: repository, checkSignatures: async () => "PASSED" }
  );

  assert.equal(verdicts.length, 2);
});

test("only archived verdicts are checked", async () => {
  const { signatureChecks, repository } = recordingRepository();

  await consumeComplianceEvents(
    [event("BatchCreated", { batchId: "B-1" }), evidenceSubmitted()],
    { verdictRepository: repository, checkSignatures: async () => "PASSED" }
  );

  assert.deepEqual(signatureChecks, [{ evidenceId: "EV-1", outcome: "PASSED" }]);
});

test("a listener with no checker behaves exactly as before", async () => {
  const { verdicts, signatureChecks, repository } = recordingRepository();

  await consumeComplianceEvents([evidenceSubmitted()], { verdictRepository: repository });

  assert.equal(verdicts.length, 1);
  assert.deepEqual(signatureChecks, []);
});
