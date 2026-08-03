/**
 * Checks a sensor run before the oracle is allowed to store or anchor it.
 *
 * The public key comes from the regulator's on-chain registry, not from the readings file. Signature
 * and sequence checks make changed, missing, duplicated or impersonated readings visible.
 */
import { sensorPublicKey, verifyReadingSignature } from "@fresh-milk/storage";
import type { CanonicalTemperatureReading } from "./canonicalise.js";

export interface SensorPublicKey {
  readonly publicKey: string;
  readonly active: boolean;
}

// Undefined means Fabric confirmed that the sensor has no registered key. Lookup failures throw.
export type SensorKeyLookup = (sensorId: string) => Promise<SensorPublicKey | undefined>;

export class ReadingsRejected extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ReadingsRejected";
  }
}

/**
 * Verifies that one sensor produced a complete, ordered run and that every signature matches the
 * active public key registered for that sensor on Fabric.
 */
export async function verifyReadings(
  readings: readonly CanonicalTemperatureReading[],
  lookup: SensorKeyLookup
): Promise<void> {
  if (readings.length === 0) {
    throw new ReadingsRejected("There are no readings to verify.");
  }

  // One evidence record and sequence belong to one sensor.
  const sensorIds = [...new Set(readings.map((reading) => reading.sensorId))];
  if (sensorIds.length > 1) {
    throw new ReadingsRejected(
      `Readings must all come from one sensor, found: ${sensorIds.join(", ")}.`
    );
  }

  const sensorId = sensorIds[0];
  const sensorKey = await lookup(sensorId);
  if (!sensorKey) {
    throw new ReadingsRejected(
      `Sensor '${sensorId}' has no key registered on the ledger, so its readings cannot be ` +
        `checked. A regulator must register it first.`
    );
  }
  if (!sensorKey.active) {
    throw new ReadingsRejected(
      `Sensor '${sensorId}' has had its key revoked, so its readings are no longer accepted.`
    );
  }

  assertContiguousSequence(readings, sensorId);

  const publicKey = sensorPublicKey(sensorKey.publicKey);

  for (const reading of readings) {
    if (!verifyReadingSignature(reading, reading.signature, publicKey)) {
      throw new ReadingsRejected(
        `Reading ${reading.sequence} of sensor '${sensorId}' does not match its signature, so it ` +
          `was altered after the sensor recorded it. Nothing has been submitted.`
      );
    }
  }
}

/** Detects missing or duplicate readings through the signed sequence numbers. */
function assertContiguousSequence(
  readings: readonly CanonicalTemperatureReading[],
  sensorId: string
): void {
  // A complete run has the sorted sequence 1 through N.
  const sequences = readings.map((reading) => reading.sequence).sort((a, b) => a - b);
  const wrong = sequences.findIndex((value, index) => value !== index + 1);
  if (wrong === -1) {
    return;
  }

  const found = sequences[wrong];
  const expected = wrong + 1;

  if (wrong > 0 && found === sequences[wrong - 1]) {
    throw new ReadingsRejected(`Sensor '${sensorId}' reported reading ${found} more than once.`);
  }
  if (wrong === 0) {
    throw new ReadingsRejected(
      `Sensor '${sensorId}' starts at reading ${found} rather than 1, so earlier readings ` +
        `are missing.`
    );
  }
  throw new ReadingsRejected(
    `Sensor '${sensorId}' is missing reading ${expected}: the run jumps to ${found}. A reading ` +
      `was removed after the sensor signed it.`
  );
}
