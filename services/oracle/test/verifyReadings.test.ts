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

// The three readings from the unsafe fixture, genuinely signed. The third breaches the cold chain,
// so it is the one a dishonest oracle would want gone.
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
    sensorId: "SENSOR-002",
    publicKey: SENSOR.publicKey,
    algorithm: "ed25519",
    active: true,
    ...overrides
  };
  return async () => record;
};

const notRegistered: SensorKeyLookup = async () => undefined;

const verify = (readings: readonly RawTemperatureReading[], lookup: SensorKeyLookup = registered()) =>
  verifyReadings(canonicaliseReadings(readings), lookup);

describe("verifying a signed run of readings", () => {
  it("accepts readings the registered sensor actually signed", async () => {
    await verify(signedRun());
  });

  // The whole point. The oracle can change the number, but it holds no private key, so it cannot
  // produce a signature that fits what it wrote.
  it("refuses a run where one temperature was changed", async () => {
    const readings = signedRun();
    readings[2] = { ...readings[2], celsius: 3.4 };

    await assert.rejects(verify(readings), /Reading 3 .* does not match its signature/);
  });

  // A signature says nothing about a reading that was removed: everything left still verifies
  // perfectly. The sequence is what makes the hole visible.
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

  // Renumbering is the obvious way to hide the hole above, which is exactly why the sequence is
  // inside the signature rather than a column beside it.
  it("refuses a run whose sequence numbers were rewritten to close a gap", async () => {
    const readings = signedRun();
    const closed = [readings[0], { ...readings[2], sequence: 2 }];

    await assert.rejects(verify(closed), /Reading 2 .* does not match its signature/);
  });

  it("refuses a run with the same reading twice", async () => {
    const readings = signedRun();

    await assert.rejects(verify([readings[0], readings[1], readings[1]]), /reported reading 2 more than once/);
  });

  // Registering your own key against someone else's sensor buys nothing, because the key checked
  // against is the one the regulator put on the ledger.
  it("refuses readings signed by a key the ledger does not vouch for", async () => {
    await assert.rejects(verify(signedRun(keypair().privateKey)), /does not match its signature/);
  });

  it("refuses readings from a sensor with no registered key", async () => {
    await assert.rejects(verify(signedRun(), notRegistered), /has no key registered on the ledger/);
  });

  // A revoked sensor is one the regulator has disowned, so its readings stop being accepted even
  // though the signatures on them are still mathematically valid.
  it("refuses readings from a revoked sensor", async () => {
    await assert.rejects(
      verify(signedRun(), registered({ active: false })),
      /has had its key revoked/
    );
  });

  // The sequence is only contiguous within one device's run, and the evidence record names a single
  // sensor, so a mixed file would be checked against the wrong key and the wrong sequence at once.
  it("refuses a file mixing two sensors", async () => {
    const readings = signedRun();
    readings[1] = { ...readings[1], sensorId: "SENSOR-999" };

    await assert.rejects(verify(readings), /must all come from one sensor/);
  });

  it("refuses an empty run rather than passing it as nothing to check", async () => {
    await assert.rejects(verifyReadings([], registered()), /no readings to verify/);
  });

  // The distinction the whole check rests on. Being unable to reach the ledger says nothing about
  // whether a sensor is registered; treating it as "not registered" would refuse honest readings,
  // and treating it as "fine" would wave through forged ones. It has to stop the run either way.
  it("refuses rather than fails open when the ledger cannot be reached", async () => {
    const unreachable = async () => {
      throw new Error("14 UNAVAILABLE: no connection established");
    };

    await assert.rejects(verify(signedRun(), unreachable), /UNAVAILABLE/);
  });
});
