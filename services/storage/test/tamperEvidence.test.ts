import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseArguments, tamperWithEvidence } from "../src/tamperEvidence.js";
import { sha256TemperatureReadings } from "../src/evidenceHash.js";
import type { TemperatureRepository } from "../src/repositories/temperatureRepository.js";

// The tamper command must refuse unsafe starting states before changing data.
describe("tamper demo arguments", () => {
  it("requires the evidence to change", () => {
    assert.throws(() => parseArguments([]), /Usage: pnpm demo:tamper/);
    assert.throws(() => parseArguments(["--evidence", "   "]), /Usage: pnpm demo:tamper/);
  });

  it("refuses a change too small to alter the fingerprint", () => {
    assert.throws(() => parseArguments(["--evidence", "EV-1", "--delta", "0"]), /at least 0.01/);
    assert.throws(
      () => parseArguments(["--evidence", "EV-1", "--delta", "not a number"]),
      /at least 0.01/
    );
  });

  it("treats the confirmation flag as absent unless it is given", () => {
    assert.equal(parseArguments(["--evidence", "EV-1"]).confirmed, false);
    assert.equal(parseArguments(["--evidence", "EV-1", "--confirm-tamper"]).confirmed, true);
  });

  it("defaults the change to one degree", () => {
    assert.equal(parseArguments(["--evidence", "EV-1"]).deltaCelsius, 1);
    assert.equal(parseArguments(["--evidence", "EV-1", "--delta", "-2.5"]).deltaCelsius, -2.5);
  });
});

const READINGS = [
  { sensorId: "S-1", recordedAt: "2026-07-30T00:00:00.000Z", celsius: 2 },
  { sensorId: "S-1", recordedAt: "2026-07-30T01:00:00.000Z", celsius: 3 }
];

const anchoredEvidence = (overrides: Record<string, unknown> = {}) => ({
  evidenceId: "EV-1",
  batchId: "B-1",
  sensorId: "S-1",
  evidenceHash: sha256TemperatureReadings("B-1", READINGS),
  minCelsius: 2,
  maxCelsius: 3,
  readingCount: 2,
  complianceOutcome: "COMPLIANT" as const,
  submissionStatus: "ANCHORED" as const,
  fabricTransactionId: "tx-1",
  ...overrides
});

// Simulate the database returning the changed reading after mutation.
function tamperableStore(evidence = anchoredEvidence()) {
  let readings = READINGS;
  return {
    repository: {
      getEvidence: async () => evidence,
      getReadings: async () => readings
    } as unknown as TemperatureRepository,
    alterEarliestReading: async (_evidenceId: string, delta: number) => {
      readings = [{ ...readings[0], celsius: readings[0].celsius + delta }, ...readings.slice(1)];
      return { reading_id: "1", old_celsius: "2", new_celsius: String(readings[0].celsius) };
    }
  };
}

const confirmed = { evidenceId: "EV-1", deltaCelsius: 1, confirmed: true };

describe("tampering with anchored evidence", () => {
  it("turns a matching fingerprint into a mismatch", async () => {
    const report = await tamperWithEvidence(confirmed, tamperableStore());

    assert.equal((report.before as Record<string, string>).result, "MATCH");
    assert.equal((report.after as Record<string, string>).result, "HASH_MISMATCH");
    assert.equal(report.anchoredHash, sha256TemperatureReadings("B-1", READINGS));
    assert.equal(report.fabricTransactionId, "tx-1");
  });

  it("refuses to change anything without the confirmation flag", async () => {
    await assert.rejects(
      tamperWithEvidence({ ...confirmed, confirmed: false }, tamperableStore()),
      /--confirm-tamper/
    );
  });

  it("refuses evidence it cannot find", async () => {
    const store = tamperableStore();
    await assert.rejects(
      tamperWithEvidence(confirmed, {
        ...store,
        repository: { ...store.repository, getEvidence: async () => undefined }
      }),
      /does not exist/
    );
  });

  // Unanchored evidence has no immutable ledger fingerprint to compare after the change.
  it("refuses evidence that was never anchored", async () => {
    for (const overrides of [
      { submissionStatus: "PENDING" as const },
      { fabricTransactionId: null }
    ]) {
      await assert.rejects(
        tamperWithEvidence(confirmed, tamperableStore(anchoredEvidence(overrides))),
        /is not anchored to Fabric/
      );
    }
  });

  it("refuses evidence that already fails verification", async () => {
    await assert.rejects(
      tamperWithEvidence(
        confirmed,
        tamperableStore(anchoredEvidence({ evidenceHash: "b".repeat(64) }))
      ),
      /already fails verification/
    );
  });

  it("reports when there was no reading to change", async () => {
    const store = tamperableStore();
    await assert.rejects(
      tamperWithEvidence(confirmed, { ...store, alterEarliestReading: async () => undefined }),
      /no readings to modify/
    );
  });
});
