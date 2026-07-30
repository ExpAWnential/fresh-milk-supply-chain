/**
 * Puts readings into the one exact form the fingerprint is computed over: trimmed text, ISO
 * timestamps, temperatures to three decimals, in a fixed order.
 *
 * Two runs over the same readings have to produce byte-identical output, or the hash means
 * nothing.
 */
// Sorted with the storage package's comparator, the same one the hash uses, so the order this
// produces and the order the fingerprint is built from can never disagree.
import { compareTemperatureReadings } from "@fresh-milk/storage";

export interface RawTemperatureReading {
  readonly batchId: string;
  readonly sensorId: string;
  readonly recordedAt: string;
  readonly celsius: number;
}

export interface CanonicalTemperatureReading {
  readonly batchId: string;
  readonly sensorId: string;
  readonly recordedAt: string;
  readonly celsius: number;
}

export function canonicaliseReadings(
  readings: readonly RawTemperatureReading[]
): readonly CanonicalTemperatureReading[] {
  return readings
    .map((reading) => ({
      batchId: normaliseRequiredText(reading.batchId, "batchId"),
      sensorId: normaliseRequiredText(reading.sensorId, "sensorId"),
      recordedAt: normaliseTimestamp(reading.recordedAt),
      celsius: normaliseTemperature(reading.celsius)
    }))
    .sort(compareTemperatureReadings);
}

function normaliseRequiredText(value: string, fieldName: string): string {
  const normalised = value.trim();

  if (!normalised) {
    throw new Error(`Missing required CSV field: ${fieldName}`);
  }

  return normalised;
}

function normaliseTimestamp(value: string): string {
  const parsed = new Date(value.trim());

  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid recordedAt timestamp: ${value}`);
  }

  return parsed.toISOString();
}

function normaliseTemperature(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid celsius value: ${value}`);
  }

  return Number(value.toFixed(3));
}

