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

    assert.equal(verifyReadingSignature(READING, signReading(READING, privateKey), publicKey), true);
  });

  // The whole point. The oracle can change the number, but it holds no private key, so it cannot
  // produce a signature that fits the number it wrote.
  it("refuses a reading whose temperature was changed", () => {
    const { privateKey, publicKey } = keypair();
    const signature = signReading(READING, privateKey);

    assert.equal(
      verifyReadingSignature({ ...READING, celsius: 3.4 }, signature, publicKey),
      false
    );
  });

  // The sequence is what makes a deleted reading visible, so it has to be inside the signature.
  // If it were merely stored beside it, the oracle would renumber 1,3 back to 1,2 and the gap
  // would vanish.
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

  // Registering your own key against someone else's sensor ID has to buy nothing.
  it("refuses a signature made by a different key", () => {
    const impostor = keypair();
    const genuine = keypair();

    assert.equal(
      verifyReadingSignature(READING, signReading(READING, impostor.privateKey), genuine.publicKey),
      false
    );
  });

  // These arrive from a CSV column and from a ledger record, so both are attacker-influenced. A
  // throw here would crash the regulator's event listener mid-stream rather than failing one row.
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
  // The signer and the verifier normalise independently. If one of them wrote 08:15:00Z and the
  // other 08:15:00.000Z, every signature would fail against readings nobody had touched.
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
