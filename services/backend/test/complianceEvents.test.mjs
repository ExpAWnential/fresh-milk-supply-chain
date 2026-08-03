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

// Every field the contract puts on the event. The archive stores all of them, so a fixture that
// dropped one would be testing a payload the chaincode never emits.
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

// The oracle stores its own reading of the range in its own database. The contract derives the
// verdict again on chain, and that is the one the regulator's archive has to end up holding.
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

// The contract announces an unsafe verdict under its own event name. Ignoring it would leave the
// regulator with no record of the reading that matters most.
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

  // Resolving a breach does not revise the evidence: the reading was still unsafe when it was
  // taken, and that stays on the record.
  for (const name of ["ColdChainBreachResolved", "BatchCreated", "BatchDelivered"]) {
    const applied = await applyComplianceEvent(event(name, { batchId: "B-1" }), repository);
    assert.equal(applied, undefined, name);
  }
  assert.equal(verdicts.length, 0);
});

// A restart replays from the last checkpoint, so the same event arriving twice has to be safe.
test("the same event applied twice archives the same thing", async () => {
  const { verdicts, repository } = recordingRepository();
  await applyComplianceEvent(evidenceSubmitted(), repository);
  await applyComplianceEvent(evidenceSubmitted(), repository);

  assert.deepEqual(verdicts[0], verdicts[1]);
});

// Every archived column is NOT NULL. A payload missing one would fail at the insert, and that
// throw leaves the event uncheckpointed, so the same broken event would retry on every restart
// forever. It has to be rejected here, before it ever reaches the database.
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

  // Including the ones it ignores, otherwise the stream would never move past them.
  assert.deepEqual(checkpointed, ["TemperatureEvidenceSubmitted", "BatchCreated"]);
});

// The checkpoint is a single cursor. Carrying on past a failed write would move it beyond a
// verdict that was never archived, and nothing would ever come back for it: the regulator's
// archive would quietly disagree with the ledger forever. Stopping leaves the cursor on the last
// event that really was archived, so a restart replays from exactly there.
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

  // Neither the failed event nor the one after it. EV-2 is left for the restart to redeliver
  // along with EV-BROKEN, and applying either twice writes the same values.
  assert.deepEqual(checkpointed, []);
});

// An event is only checkpointed once its write has actually landed.
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

// ---------------------------------------------------------------------------------------------
// The regulator checking signatures itself, as each verdict lands, rather than when asked.
// ---------------------------------------------------------------------------------------------

// A failed archive write stops the stream, on purpose. A signature result must not, and the two
// reasons are different: the verdict is already archived by the time this runs, and a forged
// reading is a finding about the evidence rather than a hole in the archive. Stopping would let one
// dishonest submission halt the archiving of every verdict after it.
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

// The oracle being unreachable must not take the regulator's archive down with it. UNKNOWN says
// "not checked", which is honestly different from "checked and forged".
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

// The row already defaults to UNKNOWN, so a later look can still settle it. Losing the archive over
// a failed status update would be the worse trade.
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

// Events the archive ignores have no evidence to check, so nothing should be attempted for them.
test("only archived verdicts are checked", async () => {
  const { signatureChecks, repository } = recordingRepository();

  await consumeComplianceEvents(
    [event("BatchCreated", { batchId: "B-1" }), evidenceSubmitted()],
    { verdictRepository: repository, checkSignatures: async () => "PASSED" }
  );

  assert.deepEqual(signatureChecks, [{ evidenceId: "EV-1", outcome: "PASSED" }]);
});

// A company with no archive keeps the listener it always had.
test("a listener with no checker behaves exactly as before", async () => {
  const { verdicts, signatureChecks, repository } = recordingRepository();

  await consumeComplianceEvents([evidenceSubmitted()], { verdictRepository: repository });

  assert.equal(verdicts.length, 1);
  assert.deepEqual(signatureChecks, []);
});
