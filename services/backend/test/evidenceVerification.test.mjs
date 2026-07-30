import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { sha256TemperatureReadings } from "@fresh-milk/storage";
import { createApp } from "../dist/app.js";
import {
  EvidenceVerificationError,
  verifyTemperatureEvidence
} from "../dist/services/evidenceVerification.js";

const originalReadings = [
  { sensorId: "SENSOR-01", recordedAt: "2026-07-20T09:00:00Z", celsius: 3.2 },
  { sensorId: "SENSOR-01", recordedAt: "2026-07-20T09:05:00Z", celsius: 3.5 }
];
const anchoredHash = sha256TemperatureReadings("MILK-001", originalReadings);

function repository(readings = originalReadings, overrides = {}) {
  return {
    saveEvidence: async () => {},
    markAnchored: async () => {},
    markFailed: async () => {},
    getEvidence: async () => ({
      evidenceId: "TEMP-001",
      batchId: "MILK-001",
      sensorId: "SENSOR-01",
      evidenceHash: anchoredHash,
      minCelsius: 3.2,
      maxCelsius: 3.5,
      averageCelsius: 3.35,
      readingCount: 2,
      complianceOutcome: "COMPLIANT",
      submissionStatus: "ANCHORED",
      fabricTransactionId: "tx-001",
      ...overrides
    }),
    getReadings: async () => readings
  };
}

test("verification reports a match for unchanged off-chain readings", async () => {
  const result = await verifyTemperatureEvidence("TEMP-001", {
    temperatureRepository: repository()
  });

  assert.equal(result.match, true);
  assert.equal(result.databaseHashMatchesAnchor, true);
  assert.equal(result.anchorSource, "CONFIRMED_DATABASE_RECORD");
  assert.equal(result.recomputedHash, anchoredHash);
});

test("verification detects a modified off-chain reading", async () => {
  const changedReadings = [
    { ...originalReadings[0], celsius: originalReadings[0].celsius + 1 },
    originalReadings[1]
  ];
  const result = await verifyTemperatureEvidence("TEMP-001", {
    temperatureRepository: repository(changedReadings)
  });

  assert.equal(result.match, false);
  assert.notEqual(result.recomputedHash, result.anchoredHash);
});

test("a Fabric reader takes precedence and detects a database anchor mismatch", async () => {
  const fabricHash = "f".repeat(64);
  const result = await verifyTemperatureEvidence("TEMP-001", {
    temperatureRepository: repository(),
    anchoredEvidenceReader: {
      getAnchoredEvidence: async () => ({
        evidenceHash: fabricHash,
        fabricTransactionId: "fabric-tx-002"
      })
    }
  });

  assert.equal(result.anchorSource, "FABRIC");
  assert.equal(result.fabricTransactionId, "fabric-tx-002");
  assert.equal(result.databaseHashMatchesAnchor, false);
  assert.equal(result.match, false);
});

test("unanchored evidence is rejected", async () => {
  await assert.rejects(
    verifyTemperatureEvidence("TEMP-001", {
      temperatureRepository: repository(originalReadings, {
        submissionStatus: "PENDING",
        fabricTransactionId: null
      })
    }),
    (error) =>
      error instanceof EvidenceVerificationError &&
      error.code === "EVIDENCE_NOT_ANCHORED"
  );
});

test("HTTP verification endpoint returns the verification result", async () => {
  const unusedLedger = async () => {
    throw new Error("verification must not open a ledger connection when a reader is supplied");
  };
  const app = createApp({
    connect: unusedLedger,
    readAsRegulator: unusedLedger,
    temperatureRepository: repository()
  });
  const server = app.listen(0);
  await once(server, "listening");

  try {
    const address = server.address();
    assert.notEqual(address, null);
    assert.equal(typeof address, "object");
    const response = await fetch(
      `http://127.0.0.1:${address.port}/temperature/evidence/TEMP-001/verify`
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.match, true);
    assert.equal(body.evidenceId, "TEMP-001");
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
