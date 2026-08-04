/**
 * Defines how a sensor reading is signed and independently verified with Ed25519.
 *
 * The payload format is deliberately shared by the sensor, oracle and regulator. Changing its
 * field order or normalisation would invalidate signatures that were created with the earlier form.
 */
import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import { normaliseRecordedAt, requireText, roundCelsius } from "./evidenceHash.js";

export interface SignableReading {
  readonly batchId: string;
  readonly sensorId: string;
  // Signing the sequence makes missing readings detectable without trusting the oracle's numbering.
  readonly sequence: number;
  readonly recordedAt: string;
  readonly celsius: number;
}

// The signed reading's file format. The sensor writes these columns and the oracle requires them,
// so both take the list from here rather than keeping copies that could drift apart.
export const SIGNED_READING_COLUMNS = [
  "batchId",
  "sensorId",
  "sequence",
  "recordedAt",
  "celsius",
  "signature"
] as const;

export function requireSequence(value: number, label = "Reading sequence"): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}

// Property order is part of the signed JSON payload. Reordering these fields breaks old signatures.
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

export function sensorPublicKey(publicKeyBase64: string): KeyObject {
  return createPublicKey({
    key: Buffer.from(publicKeyBase64, "base64"),
    format: "der",
    type: "spki"
  });
}

/** Signs one canonical reading payload with the sensor's private Ed25519 key. */
export function signReading(reading: SignableReading, privateKeyBase64: string): string {
  const key = createPrivateKey({
    key: Buffer.from(privateKeyBase64, "base64"),
    format: "der",
    type: "pkcs8"
  });

  // Ed25519 fixes its own digest algorithm, represented by null in Node's API.
  return sign(null, Buffer.from(signablePayload(reading), "utf8"), key).toString("base64");
}

/** Returns false for invalid readings, signatures and keys instead of interrupting a verification run. */
export function verifyReadingSignature(
  reading: SignableReading,
  signature: string,
  // Accept a parsed key so callers can reuse it across a complete run.
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
