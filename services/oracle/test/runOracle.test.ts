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

describe("oracle run", () => {
  it("stores the readings before anchoring, then links the confirmed transaction", async () => {
    const { calls, repository } = recordingRepository();

    const result = await runOracle(READINGS, { repository, anchor: anchorSucceeds });

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
    const result = await runOracle(READINGS, { repository, anchor: anchorSucceeds });

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
      anchor: async () => ({ submittedTxId: "tx-1", complianceOutcome: "UNSAFE" as const })
    });
    assert.equal(result.complianceOutcome, "UNSAFE");
  });

  it("marks the evidence failed when anchoring is rejected", async () => {
    const { calls, repository } = recordingRepository();

    await assert.rejects(
      runOracle(READINGS, {
        repository,
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

  it("refuses readings that span more than one batch", async () => {
    const { calls, repository } = recordingRepository();

    await assert.rejects(
      runOracle([...READINGS, { ...READINGS[0], batchId: "BATCH-002" }], {
        repository,
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
      runOracle([], { repository, anchor: anchorSucceeds }),
      /must all belong to one batch/
    );
  });
});
