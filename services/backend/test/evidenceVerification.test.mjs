import assert from "node:assert/strict";
import test from "node:test";
import { sha256TemperatureReadings } from "@fresh-milk/storage";
import {
  EvidenceVerificationError,
  verifyTemperatureEvidence
} from "../dist/services/evidenceVerification.js";
import { repositoryStub, storedEvidence } from "./harness.mjs";

const originalReadings = [
  { sensorId: "SENSOR-01", recordedAt: "2026-07-20T09:00:00Z", celsius: 3.2 },
  { sensorId: "SENSOR-01", recordedAt: "2026-07-20T09:05:00Z", celsius: 3.5 }
];
const anchoredHash = sha256TemperatureReadings("MILK-001", originalReadings);

function repository(readings = originalReadings, overrides = {}) {
  return repositoryStub({
    getEvidence: async () =>
      storedEvidence({ batchId: "MILK-001", evidenceHash: anchoredHash, ...overrides }),
    getReadings: async () => readings
  });
}

function ledgerHolding(evidenceHash, fabricTransactionId = "tx-on-ledger") {
  return { getAnchoredEvidence: async () => ({ evidenceHash, fabricTransactionId }) };
}

test("unchanged readings still hash to what the ledger anchored", async () => {
  const result = await verifyTemperatureEvidence("EV-1", {
    temperatureRepository: repository(),
    anchoredEvidenceReader: ledgerHolding(anchoredHash)
  });

  assert.equal(result.match, true);
  assert.equal(result.databaseHashMatchesAnchor, true);
  assert.equal(result.recomputedHash, anchoredHash);
  // The transaction reported is the one the ledger holds, not the database's copy of it.
  assert.equal(result.fabricTransactionId, "tx-on-ledger");
});

test("a modified reading no longer matches the anchor", async () => {
  const changed = [{ ...originalReadings[0], celsius: 4.2 }, originalReadings[1]];
  const result = await verifyTemperatureEvidence("EV-1", {
    temperatureRepository: repository(changed),
    anchoredEvidenceReader: ledgerHolding(anchoredHash)
  });

  assert.equal(result.match, false);
  assert.notEqual(result.recomputedHash, result.anchoredHash);
  // The stored hash was not touched, only the readings, so it still agrees with the ledger.
  assert.equal(result.databaseHashMatchesAnchor, true);
});

test("a rewritten stored hash is distinguished from rewritten readings", async () => {
  const result = await verifyTemperatureEvidence("EV-1", {
    temperatureRepository: repository(originalReadings, { evidenceHash: "f".repeat(64) }),
    anchoredEvidenceReader: ledgerHolding(anchoredHash)
  });

  // The readings are intact, so they still match the ledger.
  assert.equal(result.match, true);
  // But the database's own copy of the hash does not, which is the tell.
  assert.equal(result.databaseHashMatchesAnchor, false);
});

test("the ledger's anchor wins over the database's record of it", async () => {
  const ledgerHash = "e".repeat(64);
  const result = await verifyTemperatureEvidence("EV-1", {
    temperatureRepository: repository(),
    anchoredEvidenceReader: ledgerHolding(ledgerHash)
  });

  assert.equal(result.anchoredHash, ledgerHash);
  assert.equal(result.match, false);
  assert.equal(result.databaseHashMatchesAnchor, false);
});

test("evidence that was never anchored is refused rather than checked", async () => {
  await assert.rejects(
    verifyTemperatureEvidence("EV-1", {
      temperatureRepository: repository(originalReadings, {
        submissionStatus: "PENDING",
        fabricTransactionId: null
      }),
      anchoredEvidenceReader: ledgerHolding(anchoredHash)
    }),
    (error) =>
      error instanceof EvidenceVerificationError && error.code === "EVIDENCE_NOT_ANCHORED"
  );
});
