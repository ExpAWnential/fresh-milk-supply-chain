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

// Hash and statistics cases use an unavailable sensor key. Real signature checks appear below.
const noKeyAvailable = { getSensorKey: async () => undefined };

const originalReadings = [
  { sensorId: "SENSOR-01", recordedAt: "2026-07-20T09:00:00Z", celsius: 3.2 },
  { sensorId: "SENSOR-01", recordedAt: "2026-07-20T09:05:00Z", celsius: 3.5 }
];
const anchoredHash = sha256TemperatureReadings("MILK-001", originalReadings);

// Local source includes the holder's stored hash.
function heldLocally(readings = originalReadings, overrides = {}) {
  return localReadingsSource(
    repositoryStub({
      getEvidence: async () =>
        storedEvidence({ batchId: "MILK-001", evidenceHash: anchoredHash, ...overrides }),
      getReadings: async () => readings
    })
  );
}

// Remote source includes readings only.
function fetchedFromTheHolder(readings = originalReadings) {
  return { getReadings: async () => ({ readings }) };
}

// The honest summary of originalReadings, which is what the oracle should have anchored.
const honestStatistics = {
  minCelsius: 3.2,
  maxCelsius: 3.5,
  readingCount: 2
};

function ledgerHolding(
  evidenceHash,
  fabricTransactionId = "tx-on-ledger",
  statistics = honestStatistics
) {
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

// A valid hash cannot detect a dishonest summary anchored beside it.
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
    // Build directly to omit statistics from this compatibility case.
    sensorKeyReader: noKeyAvailable,
    anchoredEvidenceReader: {
      getAnchoredEvidence: async () => ({
        batchId: "MILK-001",
        evidenceHash: anchoredHash,
        fabricTransactionId: "tx-on-ledger"
      })
    }
  });

  // Missing statistics is inconclusive, not a mismatch.
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
    (error) => error instanceof EvidenceVerificationError && error.code === "EVIDENCE_NOT_ANCHORED"
  );
});

// A remote verifier detects changed readings using Fabric's independent anchor.
test("a company holding no database still catches altered readings", async () => {
  const changed = [{ ...originalReadings[0], celsius: 4.2 }, originalReadings[1]];
  const result = await verifyTemperatureEvidence("EV-1", {
    readingsSource: fetchedFromTheHolder(changed),
    sensorKeyReader: noKeyAvailable,
    anchoredEvidenceReader: ledgerHolding(anchoredHash)
  });

  assert.equal(result.match, false);
  assert.notEqual(result.recomputedHash, anchoredHash);
  // A remote checker cannot judge the holder's undisclosed stored hash.
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

// The batch ID used for hashing must come from Fabric.
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

// Signature verification uses the sensor key registered on Fabric.

const SENSOR = generateKeyPairSync("ed25519");
const SENSOR_PUBLIC_KEY = SENSOR.publicKey
  .export({ format: "der", type: "spki" })
  .toString("base64");
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

// Rehashing altered data still passes when the oracle also controls the anchor. The signature fails.
test("a reading altered before anchoring fails the signature even though the hash agrees", async () => {
  const tampered = [SIGNED_READINGS[0], { ...SIGNED_READINGS[1], celsius: 3.4 }];
  const recomputed = sha256TemperatureReadings("MILK-001", tampered);

  const result = await verifySigned(tampered, registeredKey(), recomputed);

  assert.equal(result.match, true, "the oracle's own fingerprint covers what it stored");
  assert.equal(result.signaturesMatch, false, "but it could not forge the sensor's signature");
  assert.equal(result.signatureIssue, "FORGED");
  assert.deepEqual(result.signatureFailures, [2], "and the failing reading is named");
});

// Missing registration is not reported as a forged reading.
test("an unregistered sensor is unverified without accusing anyone of forgery", async () => {
  const result = await verifySigned(SIGNED_READINGS, { getSensorKey: async () => undefined });

  assert.equal(result.signaturesMatch, false);
  assert.equal(result.signatureIssue, "SENSOR_NOT_REGISTERED");
  assert.deepEqual(result.signatureFailures, [], "no reading failed its own signature");
});

// Revocation and signature forgery remain distinct outcomes.
test("a revoked sensor is unverified for revocation, not for forgery", async () => {
  const result = await verifySigned(SIGNED_READINGS, registeredKey({ active: false }));

  assert.equal(result.signaturesMatch, false);
  assert.equal(result.signatureIssue, "SENSOR_REVOKED");
  assert.deepEqual(result.signatureFailures, []);
});

// An unavailable key lookup produces no signature verdict.
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

  const result = await verifySigned(
    mixed,
    registeredKey(),
    sha256TemperatureReadings("MILK-001", mixed)
  );

  assert.equal(result.signaturesMatch, false);
  assert.equal(result.signatureIssue, "MIXED_SENSORS");
});
