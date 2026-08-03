/**
 * Converts parsed sensor rows into the stable representation used by hashing and signatures.
 *
 * Text and timestamps are normalised, while the signed sequence and signature remain untouched.
 * This keeps equivalent input consistent without changing the bytes whose authenticity is checked.
 */
import {
  compareTemperatureReadings,
  normaliseRecordedAt,
  requireText,
  roundCelsius
} from "@fresh-milk/storage";

export interface RawTemperatureReading {
  readonly batchId: string;
  readonly sensorId: string;
  readonly sequence: number;
  readonly recordedAt: string;
  readonly celsius: number;
  readonly signature: string;
}

export interface CanonicalTemperatureReading {
  readonly batchId: string;
  readonly sensorId: string;
  readonly sequence: number;
  readonly recordedAt: string;
  readonly celsius: number;
  readonly signature: string;
}

// Preserve signed sequence values and opaque signatures without normalising them.
/** Normalises sensor rows while preserving the sequence and signature supplied by the sensor. */
export function canonicaliseReadings(
  readings: readonly RawTemperatureReading[]
): readonly CanonicalTemperatureReading[] {
  return readings
    .map((reading) => ({
      batchId: requireText(reading.batchId, "batchId"),
      sensorId: requireText(reading.sensorId, "sensorId"),
      sequence: reading.sequence,
      recordedAt: normaliseRecordedAt(reading.recordedAt),
      celsius: normaliseTemperature(reading.celsius),
      signature: requireText(reading.signature, "signature")
    }))
    .sort(compareTemperatureReadings);
}

function normaliseTemperature(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid celsius value: ${value}`);
  }

  return roundCelsius(value);
}
