import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { describe, it } from "node:test";
import { signReading } from "@fresh-milk/storage";
import { canonicaliseReadings, type RawTemperatureReading } from "../src/canonicalise.js";
import {
  verifyReadings,
  type SensorKeyLookup,
  type SensorPublicKey
} from "../src/verifyReadings.js";

function keypair() {
  const pair = generateKeyPairSync("ed25519");
  return {
    privateKey: pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    publicKey: pair.publicKey.export({ format: "der", type: "spki" }).toString("base64")
  };
}

const SENSOR = keypair();

// Genuinely signed unsafe fixture whose third reading breaches the cold chain.
function signedRun(privateKey = SENSOR.privateKey): RawTemperatureReading[] {
  return [
    { sequence: 1, recordedAt: "2026-07-14T08:00:00Z", celsius: 4.1 },
    { sequence: 2, recordedAt: "2026-07-14T08:15:00Z", celsius: 8.9 },
    { sequence: 3, recordedAt: "2026-07-14T08:30:00Z", celsius: 9.4 }
  ].map((partial) => {
    const reading = { batchId: "BATCH-002", sensorId: "SENSOR-002", ...partial };
    return { ...reading, signature: signReading(reading, privateKey) };
  });
}

const registered = (overrides: Partial<SensorPublicKey> = {}): SensorKeyLookup => {
  const record: SensorPublicKey = {
    publicKey: SENSOR.publicKey,
    active: true,
    ...overrides
  };
  return async () => record;
};

const notRegistered: SensorKeyLookup = async () => undefined;

const verify = (
  readings: readonly RawTemperatureReading[],
  lookup: SensorKeyLookup = registered()
) => verifyReadings(canonicaliseReadings(readings), lookup);

describe("verifying a signed run of readings", () => {
  it("accepts readings the registered sensor actually signed", async () => {
    await verify(signedRun());
  });

  it("refuses a run where one temperature was changed", async () => {
    const readings = signedRun();
    readings[2] = { ...readings[2], celsius: 3.4 };

    await assert.rejects(verify(readings), /Reading 3 .* does not match its signature/);
  });

  it("refuses a run with a reading removed from the middle", async () => {
    const readings = signedRun();

    await assert.rejects(
      verify([readings[0], readings[2]]),
      /missing reading 2: the run jumps to 3/
    );
  });

  it("refuses a run that starts partway through", async () => {
    const readings = signedRun();

    await assert.rejects(verify([readings[1], readings[2]]), /starts at reading 2 rather than 1/);
  });

  it("refuses a run whose sequence numbers were rewritten to close a gap", async () => {
    const readings = signedRun();
    const closed = [readings[0], { ...readings[2], sequence: 2 }];

    await assert.rejects(verify(closed), /Reading 2 .* does not match its signature/);
  });

  it("refuses a run with the same reading twice", async () => {
    const readings = signedRun();

    await assert.rejects(
      verify([readings[0], readings[1], readings[1]]),
      /reported reading 2 more than once/
    );
  });

  it("refuses readings signed by a key the ledger does not vouch for", async () => {
    await assert.rejects(verify(signedRun(keypair().privateKey)), /does not match its signature/);
  });

  it("refuses readings from a sensor with no registered key", async () => {
    await assert.rejects(verify(signedRun(), notRegistered), /has no key registered on the ledger/);
  });

  it("refuses readings from a revoked sensor", async () => {
    await assert.rejects(
      verify(signedRun(), registered({ active: false })),
      /has had its key revoked/
    );
  });

  it("refuses a file mixing two sensors", async () => {
    const readings = signedRun();
    readings[1] = { ...readings[1], sensorId: "SENSOR-999" };

    await assert.rejects(verify(readings), /must all come from one sensor/);
  });

  it("refuses an empty run rather than passing it as nothing to check", async () => {
    await assert.rejects(verifyReadings([], registered()), /no readings to verify/);
  });

  it("refuses rather than fails open when the ledger cannot be reached", async () => {
    const unreachable = async () => {
      throw new Error("14 UNAVAILABLE: no connection established");
    };

    await assert.rejects(verify(signedRun(), unreachable), /UNAVAILABLE/);
  });
});
