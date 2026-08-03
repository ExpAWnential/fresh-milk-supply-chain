/**
 * What a sensor signs, and how anyone checks it.
 *
 * The hash proves the readings were not edited after they were anchored. It cannot say anything
 * about whether they were true when they arrived, because the oracle computes the hash itself and
 * can compute it over whatever it likes. A signature the oracle cannot produce is the only thing
 * that constrains it: it can still alter a reading, but it cannot make the signature fit, and any
 * other company can see that.
 *
 * The signer and every verifier build the payload through this one function for the same reason
 * they round through roundCelsius: two ideas of what a reading is would eventually diverge and
 * report a forged signature on a reading nobody had touched.
 *
 * Ed25519 through node:crypto, so no dependency is added and a signature is 64 bytes, which is 88
 * base64 characters with no comma in the alphabet. That matters because the readings arrive through
 * a CSV parser that splits on commas and cannot quote.
 */
import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import { normaliseRecordedAt, requireText, roundCelsius } from "./evidenceHash.js";

export interface SignableReading {
  readonly batchId: string;
  readonly sensorId: string;
  // Counts from 1 within a reading set. Inside the signature rather than beside it, because a
  // sequence the oracle could renumber would not show the gap left by a deleted reading.
  readonly sequence: number;
  readonly recordedAt: string;
  readonly celsius: number;
}

export function requireSequence(value: number, label = "Reading sequence"): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}

// Key order is the declaration order of this literal, which JSON.stringify preserves. It is part of
// the signed bytes, so reordering these lines invalidates every signature ever produced.
export function signablePayload(reading: SignableReading): string {
  if (!Number.isFinite(reading.celsius)) {
    throw new Error("Temperature reading must be a finite number.");
  }

  return JSON.stringify({
    batchId: requireText(reading.batchId, "Batch ID"),
    sensorId: requireText(reading.sensorId, "Sensor ID"),
    sequence: requireSequence(reading.sequence),
    recordedAt: normaliseRecordedAt(reading.recordedAt),
    celsius: roundCelsius(reading.celsius)
  });
}

// Throws on anything that is not a usable key, so a caller hoisting this out of a loop finds out
// once rather than per reading.
export function sensorPublicKey(publicKeyBase64: string): KeyObject {
  return createPublicKey({
    key: Buffer.from(publicKeyBase64, "base64"),
    format: "der",
    type: "spki"
  });
}

export function signReading(reading: SignableReading, privateKeyBase64: string): string {
  const key = createPrivateKey({
    key: Buffer.from(privateKeyBase64, "base64"),
    format: "der",
    type: "pkcs8"
  });

  // Ed25519 takes its digest algorithm as null: the scheme fixes it, and passing one is an error.
  return sign(null, Buffer.from(signablePayload(reading), "utf8"), key).toString("base64");
}

/**
 * False rather than throwing, for every way this can fail: a malformed key, a malformed signature,
 * a reading whose timestamp cannot be parsed. A caller deciding whether to trust a reading has no
 * use for the distinction, and an exception escaping here would turn one bad row into a crash in
 * the middle of the regulator's event listener.
 */
export function verifyReadingSignature(
  reading: SignableReading,
  signature: string,
  // A KeyObject as well as base64, because both callers check a whole run against one key and
  // parsing it per reading is work with no purpose.
  publicKey: string | KeyObject
): boolean {
  try {
    const key = typeof publicKey === "string" ? sensorPublicKey(publicKey) : publicKey;

    return verify(
      null,
      Buffer.from(signablePayload(reading), "utf8"),
      key,
      Buffer.from(signature, "base64")
    );
  } catch {
    return false;
  }
}
