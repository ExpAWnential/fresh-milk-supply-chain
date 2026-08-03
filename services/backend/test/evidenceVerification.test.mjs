import assert from "node:assert/strict";
import test from "node:test";
import { sha256TemperatureReadings } from "@fresh-milk/storage";
import {
  EvidenceVerificationError,
  verifyTemperatureEvidence
} from "../dist/services/evidenceVerification.js";
import { localReadingsSource } from "../dist/services/readingsSource.js";
import { repositoryStub, storedEvidence } from "./harness.mjs";

const originalReadings = [
  { sensorId: "SENSOR-01", recordedAt: "2026-07-20T09:00:00Z", celsius: 3.2 },
  { sensorId: "SENSOR-01", recordedAt: "2026-07-20T09:05:00Z", celsius: 3.5 }
];
const anchoredHash = sha256TemperatureReadings("MILK-001", originalReadings);

// The oracle's own view: it holds the row, so it can report what its record claims the hash is.
function heldLocally(readings = originalReadings, overrides = {}) {
  return localReadingsSource(
    repositoryStub({
      getEvidence: async () =>
        storedEvidence({ batchId: "MILK-001", evidenceHash: anchoredHash, ...overrides }),
      getReadings: async () => readings
    })
  );
}

// Any other company's view: readings arrive over HTTP and nothing is claimed about the holder's
// own bookkeeping.
function fetchedFromTheHolder(readings = originalReadings) {
  return { getReadings: async () => ({ readings }) };
}

// The honest summary of originalReadings, which is what the oracle should have anchored.
const honestStatistics = {
  minCelsius: 3.2,
  maxCelsius: 3.5,
  readingCount: 2
};

function ledgerHolding(evidenceHash, fabricTransactionId = "tx-on-ledger", statistics = honestStatistics) {
  return {
    getAnchoredEvidence: async () => ({
      batchId: "MILK-001",
      evidenceHash,
      fabricTransactionId,
      statistics
    })
  };
}

test("unchanged readings still hash to what the ledger anchored", async () => {
  const result = await verifyTemperatureEvidence("EV-1", {
    readingsSource: heldLocally(),
    anchoredEvidenceReader: ledgerHolding(anchoredHash)
  });

  assert.equal(result.match, true);
  assert.equal(result.databaseHashMatchesAnchor, true);
  assert.equal(result.recomputedHash, anchoredHash);
  assert.equal(result.statisticsMatch, true);
  // The transaction reported is the one the ledger holds, not the database's copy of it.
  assert.equal(result.fabricTransactionId, "tx-on-ledger");
});

// The case the hash cannot see. The oracle stores the readings honestly, so nothing is tampered
// with and the hash agrees, but it anchors a summary that hides the spike. The contract judged
// that summary, so the ledger says COMPLIANT for milk that was not.
test("an honest reading set with a flattering summary is caught", async () => {
  const readingsWithASpike = [
    { sensorId: "SENSOR-01", recordedAt: "2026-07-20T09:00:00Z", celsius: 3.2 },
    { sensorId: "SENSOR-01", recordedAt: "2026-07-20T09:05:00Z", celsius: 9.4 }
  ];
  const hashOfThoseReadings = sha256TemperatureReadings("MILK-001", readingsWithASpike);

  const result = await verifyTemperatureEvidence("EV-1", {
    readingsSource: localReadingsSource(
      repositoryStub({
        getEvidence: async () =>
          storedEvidence({ batchId: "MILK-001", evidenceHash: hashOfThoseReadings }),
        getReadings: async () => readingsWithASpike
      })
    ),
    // Claims a 3.5 maximum, comfortably inside the safe range, for readings that hit 9.4.
    anchoredEvidenceReader: ledgerHolding(hashOfThoseReadings, "tx-on-ledger", {
      minCelsius: 3.2,
      maxCelsius: 3.5,
      readingCount: 2
    })
  });

  // Nothing was edited, so every hash check passes. This is exactly why the hash is not enough.
  assert.equal(result.match, true);
  assert.equal(result.databaseHashMatchesAnchor, true);

  assert.equal(result.statisticsMatch, false);
  assert.equal(result.anchoredStatistics.maxCelsius, 3.5);
  assert.equal(result.recomputedStatistics.maxCelsius, 9.4);
});

test("a record anchored without statistics reports the check as unavailable", async () => {
  const result = await verifyTemperatureEvidence("EV-1", {
    readingsSource: heldLocally(),
    // Built inline rather than through the helper, whose default would fill the statistics back in.
    anchoredEvidenceReader: {
      getAnchoredEvidence: async () => ({
        batchId: "MILK-001",
        evidenceHash: anchoredHash,
        fabricTransactionId: "tx-on-ledger"
      })
    }
  });

  // Not false, which would read as a detected lie rather than a check that could not be run.
  assert.equal(result.statisticsMatch, null);
  assert.equal(result.anchoredStatistics, null);
  assert.equal(result.match, true);
});

test("a modified reading no longer matches the anchor", async () => {
  const changed = [{ ...originalReadings[0], celsius: 4.2 }, originalReadings[1]];
  const result = await verifyTemperatureEvidence("EV-1", {
    readingsSource: heldLocally(changed),
    anchoredEvidenceReader: ledgerHolding(anchoredHash)
  });

  assert.equal(result.match, false);
  assert.notEqual(result.recomputedHash, result.anchoredHash);
  // The stored hash was not touched, only the readings, so it still agrees with the ledger.
  assert.equal(result.databaseHashMatchesAnchor, true);
});

test("a rewritten stored hash is distinguished from rewritten readings", async () => {
  const result = await verifyTemperatureEvidence("EV-1", {
    readingsSource: heldLocally(originalReadings, { evidenceHash: "f".repeat(64) }),
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
    readingsSource: heldLocally(),
    anchoredEvidenceReader: ledgerHolding(ledgerHash)
  });

  assert.equal(result.anchoredHash, ledgerHash);
  assert.equal(result.match, false);
  assert.equal(result.databaseHashMatchesAnchor, false);
});

test("evidence that was never anchored is refused rather than checked", async () => {
  await assert.rejects(
    verifyTemperatureEvidence("EV-1", {
      readingsSource: heldLocally(originalReadings, {
        submissionStatus: "PENDING",
        fabricTransactionId: null
      }),
      anchoredEvidenceReader: ledgerHolding(anchoredHash)
    }),
    (error) =>
      error instanceof EvidenceVerificationError && error.code === "EVIDENCE_NOT_ANCHORED"
  );
});

// The whole point of the split. The company being checked publishes only the readings, and the
// checker still catches an alteration, because the fingerprint it compares against came off the
// ledger rather than from the holder.
test("a company holding no database still catches altered readings", async () => {
  const changed = [{ ...originalReadings[0], celsius: 4.2 }, originalReadings[1]];
  const result = await verifyTemperatureEvidence("EV-1", {
    readingsSource: fetchedFromTheHolder(changed),
    anchoredEvidenceReader: ledgerHolding(anchoredHash)
  });

  assert.equal(result.match, false);
  assert.notEqual(result.recomputedHash, anchoredHash);
  // Reported as unavailable rather than false. The checker never saw the holder's own record, and
  // saying "does not match" about a value it was never given would be an accusation it cannot make.
  assert.equal(result.databaseHash, null);
  assert.equal(result.databaseHashMatchesAnchor, null);
});

test("readings fetched from another company are verified against the ledger's own batch", async () => {
  const result = await verifyTemperatureEvidence("EV-1", {
    readingsSource: fetchedFromTheHolder(),
    anchoredEvidenceReader: ledgerHolding(anchoredHash)
  });

  assert.equal(result.match, true);
  assert.equal(result.batchId, "MILK-001");
});

// The batch ID goes into the fingerprint, so taking it from the holder would let a company that
// rewrote its own batch column produce readings that still hash correctly.
test("the batch the fingerprint covers comes from the ledger, not the readings holder", async () => {
  const result = await verifyTemperatureEvidence("EV-1", {
    readingsSource: heldLocally(originalReadings, { batchId: "MILK-999" }),
    anchoredEvidenceReader: ledgerHolding(anchoredHash)
  });

  assert.equal(result.batchId, "MILK-001");
  assert.equal(result.match, true);
});

test("evidence with no readings anywhere is refused rather than reported as matching nothing", async () => {
  await assert.rejects(
    verifyTemperatureEvidence("EV-1", {
      readingsSource: { getReadings: async () => undefined },
      anchoredEvidenceReader: ledgerHolding(anchoredHash)
    }),
    (error) => error instanceof EvidenceVerificationError && error.code === "READINGS_NOT_FOUND"
  );
});
