/**
 * Defines the canonical form and SHA-256 fingerprint used for temperature evidence.
 *
 * The oracle creates the hash here, and later verification uses the same rules to recreate it from
 * stored readings. Stable ordering, timestamp handling and rounding are part of that shared contract.
 */
import { createHash } from "node:crypto";

// Hashing and statistics share this precision so independent checks produce identical values.
export const READING_DECIMALS = 3;

export function roundCelsius(value: number): number {
  return Number(value.toFixed(READING_DECIMALS));
}

export interface HashableTemperatureReading {
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

// A stable order gives the same fingerprint regardless of input row order.
export function compareTemperatureReadings(
  left: CanonicalTemperatureReading,
  right: CanonicalTemperatureReading
): number {
  return (
    left.batchId.localeCompare(right.batchId) ||
    left.recordedAt.localeCompare(right.recordedAt) ||
    left.sensorId.localeCompare(right.sensorId) ||
    left.celsius - right.celsius
  );
}

// Signature verification and hashing share the same text and timestamp normalisation.
export function requireText(value: string, label: string): string {
  const normalised = value.trim();
  if (!normalised) {
    throw new Error(`${label} must not be empty.`);
  }
  return normalised;
}

export function normaliseRecordedAt(value: string): string {
  const timestamp = new Date(value.trim());
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`Invalid temperature reading timestamp '${value}'.`);
  }
  return timestamp.toISOString();
}

function normaliseReading(
  batchId: string,
  reading: HashableTemperatureReading
): CanonicalTemperatureReading {
  const recordedAt = normaliseRecordedAt(reading.recordedAt);
  if (!Number.isFinite(reading.celsius)) {
    throw new Error("Temperature reading must be a finite number.");
  }

  return {
    batchId,
    sensorId: requireText(reading.sensorId, "Temperature reading sensor ID"),
    recordedAt,
    celsius: roundCelsius(reading.celsius)
  };
}

/** Produces the exact JSON representation whose bytes are covered by the evidence hash. */
export function canonicaliseTemperatureReadings(
  batchId: string,
  readings: readonly HashableTemperatureReading[]
): string {
  const normalisedBatchId = requireText(batchId, "Batch ID");
  if (readings.length === 0) {
    throw new Error("At least one temperature reading is required.");
  }

  const canonicalReadings = readings
    .map((reading) => normaliseReading(normalisedBatchId, reading))
    .sort(compareTemperatureReadings);

  return JSON.stringify(canonicalReadings);
}

/** Hashes a non-empty reading set after applying the shared ordering and normalisation rules. */
export function sha256TemperatureReadings(
  batchId: string,
  readings: readonly HashableTemperatureReading[]
): string {
  return createHash("sha256")
    .update(canonicaliseTemperatureReadings(batchId, readings), "utf8")
    .digest("hex");
}
