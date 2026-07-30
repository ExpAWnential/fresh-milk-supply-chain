import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sha256TemperatureReadings } from "@fresh-milk/storage";
import { AnchorError } from "../src/oracleClient.js";
import { runOracle } from "../src/runOracle.js";

const READINGS = [
  {
    batchId: "BATCH-001",
    sensorId: "SENSOR-001",
    recordedAt: "2026-07-14T08:00:00Z",
    celsius: 3.2
  },
  {
    batchId: "BATCH-001",
    sensorId: "SENSOR-001",
    recordedAt: "2026-07-14T08:15:00Z",
    celsius: 3.6
  }
];

function recordingRepository() {
  const calls: { name: string; args: readonly unknown[] }[] = [];
  return {
    calls,
    repository: {
      async saveEvidence(evidence: unknown, readings: unknown) {
        calls.push({ name: "saveEvidence", args: [evidence, readings] });
      },
      async markAnchored(evidenceId: string, transactionId: string) {
        calls.push({ name: "markAnchored", args: [evidenceId, transactionId] });
      },
      async markFailed(evidenceId: string) {
        calls.push({ name: "markFailed", args: [evidenceId] });
      },
      async getEvidence() {
        return undefined;
      },
      async listEvidenceForBatch() {
        return [];
      },
      async getReadings() {
        return [];
      }
    }
  };
}

const anchorSucceeds = async () => ({
  submittedTxId: "tx-abc",
  complianceOutcome: "COMPLIANT" as const
});

// The ledger positively reports nothing anchored under this evidence ID.
const nothingAnchored = async () => undefined;

describe("oracle run", () => {
  it("stores the readings before anchoring, then links the confirmed transaction", async () => {
    const { calls, repository } = recordingRepository();

    const result = await runOracle(READINGS, {
      repository,
      anchor: anchorSucceeds,
      readAnchored: nothingAnchored
    });

    assert.deepEqual(
      calls.map((call) => call.name),
      ["saveEvidence", "markAnchored"]
    );
    // Written as PENDING first, so a failed submission is never mistaken for anchored evidence.
    const [saved] = calls[0].args as [Record<string, unknown>];
    assert.equal(saved.submissionStatus, "PENDING");
    assert.equal(saved.fabricTransactionId, null);
    assert.deepEqual(calls[1].args, [result.evidenceId, "tx-abc"]);
    assert.equal(result.fabricTransactionId, "tx-abc");
  });

  it("fingerprints with the same function verification uses", async () => {
    const { repository } = recordingRepository();
    const result = await runOracle(READINGS, {
      repository,
      anchor: anchorSucceeds,
      readAnchored: nothingAnchored
    });

    const expected = sha256TemperatureReadings("BATCH-001", [
      { sensorId: "SENSOR-001", recordedAt: "2026-07-14T08:00:00.000Z", celsius: 3.2 },
      { sensorId: "SENSOR-001", recordedAt: "2026-07-14T08:15:00.000Z", celsius: 3.6 }
    ]);
    assert.equal(result.evidenceHash, expected);
    // The identifier is derived from the content, so the same readings always produce the same one.
    assert.equal(result.evidenceId, `EV-BATCH-001-${expected.slice(0, 8)}`);
  });

  it("reports the contract's outcome rather than its own", async () => {
    const { repository } = recordingRepository();
    // These readings are within range, yet the contract is the one that decides.
    const result = await runOracle(READINGS, {
      repository,
      readAnchored: nothingAnchored,
      anchor: async () => ({ submittedTxId: "tx-1", complianceOutcome: "UNSAFE" as const })
    });
    assert.equal(result.complianceOutcome, "UNSAFE");
  });

  it("marks the evidence failed when anchoring is rejected", async () => {
    const { calls, repository } = recordingRepository();

    await assert.rejects(
      runOracle(READINGS, {
        repository,
        readAnchored: nothingAnchored,
        anchor: async () => {
          throw new Error("batch must be IN_TRANSIT");
        }
      }),
      /batch must be IN_TRANSIT/
    );

    assert.deepEqual(
      calls.map((call) => call.name),
      ["saveEvidence", "markFailed"]
    );
  });

  // Marking a committed transaction as failed would make verification report it as never
  // anchored, and the deterministic evidence ID means it can never be submitted again.
  it("leaves the row pending when the transaction landed but the follow-up did not", async () => {
    const { calls, repository } = recordingRepository();

    await assert.rejects(
      runOracle(READINGS, {
        repository,
        readAnchored: nothingAnchored,
        anchor: async () => {
          throw new AnchorError("submitted but could not be read back", true);
        }
      }),
      /could not be read back/
    );

    assert.deepEqual(
      calls.map((call) => call.name),
      ["saveEvidence"]
    );
  });

  it("marks the row failed when the transaction never landed", async () => {
    const { calls, repository } = recordingRepository();

    await assert.rejects(
      runOracle(READINGS, {
        repository,
        readAnchored: nothingAnchored,
        anchor: async () => {
          throw new AnchorError("batch must be IN_TRANSIT", false);
        }
      }),
      /must be IN_TRANSIT/
    );

    assert.deepEqual(
      calls.map((call) => call.name),
      ["saveEvidence", "markFailed"]
    );
  });

  // The evidence ID is derived from the readings, so the contract refuses a second submission.
  // Adopting what is already there is the only way a half-finished run can ever complete.
  it("adopts the record already on the ledger when anchoring reports a failure", async () => {
    const { calls, repository } = recordingRepository();

    const result = await runOracle(READINGS, {
      repository,
      readAnchored: async () => ({ submittedTxId: "tx-earlier", complianceOutcome: "UNSAFE" }),
      anchor: async () => {
        throw new AnchorError("evidence 'EV-1' has already been anchored", false);
      }
    });

    assert.equal(result.fabricTransactionId, "tx-earlier");
    // Reported by the contract, so the recovered run says what the ledger says.
    assert.equal(result.complianceOutcome, "UNSAFE");
    assert.deepEqual(
      calls.map((call) => call.name),
      ["saveEvidence", "markAnchored"]
    );
  });

  it("leaves the row pending when the ledger cannot be consulted", async () => {
    const { calls, repository } = recordingRepository();

    await assert.rejects(
      runOracle(READINGS, {
        repository,
        readAnchored: async () => {
          throw new Error("peer unavailable");
        },
        anchor: async () => {
          throw new AnchorError("batch must be IN_TRANSIT", false);
        }
      }),
      /must be IN_TRANSIT/
    );

    // Not knowing whether the transaction landed is not proof that it did not.
    assert.deepEqual(
      calls.map((call) => call.name),
      ["saveEvidence"]
    );
  });

  it("refuses readings that span more than one batch", async () => {
    const { calls, repository } = recordingRepository();

    await assert.rejects(
      runOracle([...READINGS, { ...READINGS[0], batchId: "BATCH-002" }], {
        repository,
        readAnchored: nothingAnchored,
        anchor: anchorSucceeds
      }),
      /must all belong to one batch/
    );
    // Nothing is written, because a fingerprint spanning batches could never be verified.
    assert.equal(calls.length, 0);
  });

  it("refuses an empty reading set", async () => {
    const { repository } = recordingRepository();
    await assert.rejects(
      runOracle([], { repository, anchor: anchorSucceeds, readAnchored: nothingAnchored }),
      /must all belong to one batch/
    );
  });
});
