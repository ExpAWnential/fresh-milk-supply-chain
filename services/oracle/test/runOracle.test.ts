import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sha256TemperatureReadings } from "@fresh-milk/storage";
import { AnchorError } from "../src/oracleClient.js";
import { runOracle } from "../src/runOracle.js";

const READINGS = [
  {
    batchId: "BATCH-001",
    sensorId: "SENSOR-001",
    sequence: 1,
    recordedAt: "2026-07-14T08:00:00Z",
    celsius: 3.2,
    signature: "c2lnbmF0dXJlLTE="
  },
  {
    batchId: "BATCH-001",
    sensorId: "SENSOR-001",
    sequence: 2,
    recordedAt: "2026-07-14T08:15:00Z",
    celsius: 3.6,
    signature: "c2lnbmF0dXJlLTI="
  }
];

// Signature authenticity is covered separately. These tests focus on ordering and recovery.
const acceptsSignedReadings = async () => {};

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

// Default to a confirmed missing anchor.
const nothingAnchored = async () => undefined;

describe("oracle run", () => {
  it("stores the readings before anchoring, then links the confirmed transaction", async () => {
    const { calls, repository } = recordingRepository();

    const result = await runOracle(READINGS, {
      repository,
      verifyReadings: acceptsSignedReadings,
      anchor: anchorSucceeds,
      readAnchored: nothingAnchored
    });

    assert.deepEqual(
      calls.map((call) => call.name),
      ["saveEvidence", "markAnchored"]
    );
    // Persist PENDING before attempting Fabric submission.
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
      verifyReadings: acceptsSignedReadings,
      anchor: anchorSucceeds,
      readAnchored: nothingAnchored
    });

    const expected = sha256TemperatureReadings("BATCH-001", [
      { sensorId: "SENSOR-001", recordedAt: "2026-07-14T08:00:00.000Z", celsius: 3.2 },
      { sensorId: "SENSOR-001", recordedAt: "2026-07-14T08:15:00.000Z", celsius: 3.6 }
    ]);
    assert.equal(result.evidenceHash, expected);
    // The evidence ID is content-derived and deterministic.
    assert.equal(result.evidenceId, `EV-BATCH-001-${expected.slice(0, 8)}`);
  });

  it("reports the contract's outcome rather than its own", async () => {
    const { repository } = recordingRepository();
    // The result uses the contract's verdict even for safe readings.
    const result = await runOracle(READINGS, {
      repository,
      verifyReadings: acceptsSignedReadings,
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
        verifyReadings: acceptsSignedReadings,
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

  // A post-commit client failure must remain recoverable from Fabric.
  it("leaves the row pending when the transaction landed but the follow-up did not", async () => {
    const { calls, repository } = recordingRepository();

    await assert.rejects(
      runOracle(READINGS, {
        repository,
        verifyReadings: acceptsSignedReadings,
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
        verifyReadings: acceptsSignedReadings,
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

  // A retry adopts the existing record because the deterministic ID cannot be submitted twice.
  it("adopts the record already on the ledger when anchoring reports a failure", async () => {
    const { calls, repository } = recordingRepository();

    const result = await runOracle(READINGS, {
      repository,
      verifyReadings: acceptsSignedReadings,
      readAnchored: async () => ({ submittedTxId: "tx-earlier", complianceOutcome: "UNSAFE" }),
      anchor: async () => {
        throw new AnchorError("evidence 'EV-1' has already been anchored", false);
      }
    });

    assert.equal(result.fabricTransactionId, "tx-earlier");
    // Recovery uses Fabric's verdict.
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
        verifyReadings: acceptsSignedReadings,
        readAnchored: async () => {
          throw new Error("peer unavailable");
        },
        anchor: async () => {
          throw new AnchorError("batch must be IN_TRANSIT", false);
        }
      }),
      /must be IN_TRANSIT/
    );

    // Inconclusive state remains PENDING.
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
        verifyReadings: acceptsSignedReadings,
        readAnchored: nothingAnchored,
        anchor: anchorSucceeds
      }),
      /must all belong to one batch/
    );
    // Mixed-batch input is rejected before persistence.
    assert.equal(calls.length, 0);
  });

  it("refuses an empty reading set", async () => {
    const { repository } = recordingRepository();
    await assert.rejects(
      runOracle([], {
        repository,
        verifyReadings: acceptsSignedReadings,
        anchor: anchorSucceeds,
        readAnchored: nothingAnchored
      }),
      /must all belong to one batch/
    );
  });
});
