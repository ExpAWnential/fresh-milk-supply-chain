import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { sha256TemperatureReadings, signReading } from "@fresh-milk/storage";
import {
  EvidenceVerificationError,
  verifyTemperatureEvidence
} from "../dist/services/evidenceVerification.js";
import { localReadingsSource } from "../dist/services/readingsSource.js";
import { repositoryStub, storedEvidence } from "./harness.mjs";

// These tests are about the hash and the statistics. An unreadable key reports signaturesMatch
// as null and leaves them measuring what they always measured; the signature check has its own
// tests below, with real keys.
const noKeyAvailable = { getSensorKey: async () => undefined };

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
    sensorKeyReader: noKeyAvailable,
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
    sensorKeyReader: noKeyAvailable,
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
    sensorKeyReader: noKeyAvailable,
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
    sensorKeyReader: noKeyAvailable,
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
    sensorKeyReader: noKeyAvailable,
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
    sensorKeyReader: noKeyAvailable,
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
      sensorKeyReader: noKeyAvailable,
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
    sensorKeyReader: noKeyAvailable,
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
    sensorKeyReader: noKeyAvailable,
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
    sensorKeyReader: noKeyAvailable,
    anchoredEvidenceReader: ledgerHolding(anchoredHash)
  });

  assert.equal(result.batchId, "MILK-001");
  assert.equal(result.match, true);
});

test("evidence with no readings anywhere is refused rather than reported as matching nothing", async () => {
  await assert.rejects(
    verifyTemperatureEvidence("EV-1", {
      readingsSource: { getReadings: async () => undefined },
      sensorKeyReader: noKeyAvailable,
    anchoredEvidenceReader: ledgerHolding(anchoredHash)
    }),
    (error) => error instanceof EvidenceVerificationError && error.code === "READINGS_NOT_FOUND"
  );
});

// ---------------------------------------------------------------------------------------------
// The signature check. The hash proves the readings are unchanged since they were anchored; this
// proves they were true when they arrived, which the oracle computing its own hash never could.
// ---------------------------------------------------------------------------------------------

const SENSOR = generateKeyPairSync("ed25519");
const SENSOR_PUBLIC_KEY = SENSOR.publicKey.export({ format: "der", type: "spki" }).toString("base64");
const SENSOR_PRIVATE_KEY = SENSOR.privateKey
  .export({ format: "der", type: "pkcs8" })
  .toString("base64");

function signed(readings, privateKey = SENSOR_PRIVATE_KEY) {
  return readings.map((reading) => ({
    ...reading,
    signature: signReading({ ...reading, batchId: "MILK-001" }, privateKey)
  }));
}

const SIGNED_READINGS = signed([
  { sensorId: "SENSOR-01", sequence: 1, recordedAt: "2026-07-20T09:00:00.000Z", celsius: 3.2 },
  { sensorId: "SENSOR-01", sequence: 2, recordedAt: "2026-07-20T09:05:00.000Z", celsius: 3.5 }
]);
const signedHash = sha256TemperatureReadings("MILK-001", SIGNED_READINGS);

const registeredKey = (overrides = {}) => ({
  getSensorKey: async () => ({ publicKey: SENSOR_PUBLIC_KEY, active: true, ...overrides })
});

const verifySigned = (readings, sensorKeyReader, hash = signedHash) =>
  verifyTemperatureEvidence("EV-1", {
    readingsSource: { getReadings: async () => ({ readings }) },
    sensorKeyReader,
    anchoredEvidenceReader: ledgerHolding(hash, "tx-on-ledger", {
      minCelsius: 3.2,
      maxCelsius: 3.5,
      readingCount: 2
    })
  });

test("readings the registered sensor signed are reported as verified", async () => {
  const result = await verifySigned(SIGNED_READINGS, registeredKey());

  assert.equal(result.signaturesMatch, true);
  assert.deepEqual(result.signatureFailures, []);
  assert.equal(result.signatureIssue, null);
  assert.equal(result.match, true);
});

// The lie the hash cannot catch. A dishonest oracle recomputes its own fingerprint over whatever it
// stored, so the hash agrees with it perfectly; only the signature disagrees.
test("a reading altered before anchoring fails the signature even though the hash agrees", async () => {
  const tampered = [SIGNED_READINGS[0], { ...SIGNED_READINGS[1], celsius: 3.4 }];
  const recomputed = sha256TemperatureReadings("MILK-001", tampered);

  const result = await verifySigned(tampered, registeredKey(), recomputed);

  assert.equal(result.match, true, "the oracle's own fingerprint covers what it stored");
  assert.equal(result.signaturesMatch, false, "but it could not forge the sensor's signature");
  assert.equal(result.signatureIssue, "FORGED");
  assert.deepEqual(result.signatureFailures, [2], "and the failing reading is named");
});

// Not verified, but not accused either. Neither of these is a forged reading, and naming every row
// as failed would tell an auditor a company tampered with data it never touched.
test("an unregistered sensor is unverified without accusing anyone of forgery", async () => {
  const result = await verifySigned(SIGNED_READINGS, { getSensorKey: async () => undefined });

  assert.equal(result.signaturesMatch, false);
  assert.equal(result.signatureIssue, "SENSOR_NOT_REGISTERED");
  assert.deepEqual(result.signatureFailures, [], "no reading failed its own signature");
});

// A revoked sensor's signatures may still be mathematically valid. They are simply no longer
// accepted, which is a different statement from "these were altered".
test("a revoked sensor is unverified for revocation, not for forgery", async () => {
  const result = await verifySigned(SIGNED_READINGS, registeredKey({ active: false }));

  assert.equal(result.signaturesMatch, false);
  assert.equal(result.signatureIssue, "SENSOR_REVOKED");
  assert.deepEqual(result.signatureFailures, []);
});

// Null, never true. Reporting an unreadable ledger as verified would mean a dishonest oracle need
// only make the lookup fail; reporting it as false would accuse a holder on no evidence.
test("a ledger that cannot be read reports null rather than a verdict", async () => {
  const unreachable = {
    getSensorKey: async () => {
      throw new Error("14 UNAVAILABLE: no connection established");
    }
  };

  const result = await verifySigned(SIGNED_READINGS, unreachable);

  assert.equal(result.signaturesMatch, null);
  assert.deepEqual(result.signatureFailures, []);
  // The other two checks still answer, so an unreachable registry costs one answer and not all.
  assert.equal(result.match, true);
  assert.equal(result.statisticsMatch, true);
});

test("readings from two sensors under one evidence record are not verified", async () => {
  const mixed = [SIGNED_READINGS[0], { ...SIGNED_READINGS[1], sensorId: "SENSOR-99" }];

  const result = await verifySigned(mixed, registeredKey(), sha256TemperatureReadings("MILK-001", mixed));

  assert.equal(result.signaturesMatch, false);
  assert.equal(result.signatureIssue, "MIXED_SENSORS");
});
