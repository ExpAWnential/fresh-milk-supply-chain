import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { describe, it } from "node:test";
import {
  signablePayload,
  signReading,
  verifyReadingSignature,
  type SignableReading
} from "../src/sensorSignature.js";

function keypair(): { privateKey: string; publicKey: string } {
  const pair = generateKeyPairSync("ed25519");
  return {
    privateKey: pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    publicKey: pair.publicKey.export({ format: "der", type: "spki" }).toString("base64")
  };
}

const READING: SignableReading = {
  batchId: "BATCH-001",
  sensorId: "SENSOR-001",
  sequence: 2,
  recordedAt: "2026-07-14T08:15:00Z",
  celsius: 3.6
};

describe("signing a reading", () => {
  it("verifies against the key that signed it", () => {
    const { privateKey, publicKey } = keypair();

    assert.equal(
      verifyReadingSignature(READING, signReading(READING, privateKey), publicKey),
      true
    );
  });

  it("refuses a reading whose temperature was changed", () => {
    const { privateKey, publicKey } = keypair();
    const signature = signReading(READING, privateKey);

    assert.equal(verifyReadingSignature({ ...READING, celsius: 3.4 }, signature, publicKey), false);
  });

  // Signing the sequence prevents the oracle hiding a gap by renumbering later readings.
  it("refuses a reading whose sequence was renumbered", () => {
    const { privateKey, publicKey } = keypair();
    const signature = signReading(READING, privateKey);

    assert.equal(verifyReadingSignature({ ...READING, sequence: 1 }, signature, publicKey), false);
  });

  it("refuses a reading moved to another batch or sensor", () => {
    const { privateKey, publicKey } = keypair();
    const signature = signReading(READING, privateKey);

    assert.equal(
      verifyReadingSignature({ ...READING, batchId: "BATCH-999" }, signature, publicKey),
      false
    );
    assert.equal(
      verifyReadingSignature({ ...READING, sensorId: "SENSOR-999" }, signature, publicKey),
      false
    );
  });

  it("refuses a signature made by a different key", () => {
    const impostor = keypair();
    const genuine = keypair();

    assert.equal(
      verifyReadingSignature(READING, signReading(READING, impostor.privateKey), genuine.publicKey),
      false
    );
  });

  // Malformed external values fail one verification without crashing the event listener.
  it("reports malformed input as unverified rather than throwing", () => {
    const { privateKey, publicKey } = keypair();
    const signature = signReading(READING, privateKey);

    assert.equal(verifyReadingSignature(READING, "not base64 at all", publicKey), false);
    assert.equal(verifyReadingSignature(READING, signature, "not a key"), false);
    assert.equal(verifyReadingSignature(READING, "", publicKey), false);
    assert.equal(
      verifyReadingSignature({ ...READING, recordedAt: "whenever" }, signature, publicKey),
      false
    );
  });
});

describe("the signed payload", () => {
  it("is unchanged by timestamp format or trailing precision", () => {
    assert.equal(
      signablePayload(READING),
      signablePayload({ ...READING, recordedAt: "2026-07-14T08:15:00.000Z" })
    );
    assert.equal(signablePayload(READING), signablePayload({ ...READING, celsius: 3.6001 }));
  });

  it("is unchanged by surrounding whitespace", () => {
    assert.equal(
      signablePayload(READING),
      signablePayload({ ...READING, batchId: " BATCH-001 ", sensorId: "  SENSOR-001" })
    );
  });

  it("refuses a sequence that is not a positive integer", () => {
    for (const sequence of [0, -1, 1.5, Number.NaN]) {
      assert.throws(
        () => signablePayload({ ...READING, sequence }),
        /must be a positive integer/,
        String(sequence)
      );
    }
  });
});
