/**
 * The fingerprint the whole tamper-evidence story rests on: readings reduced to one exact
 * canonical form, then SHA-256 over it.
 *
 * The oracle, the verification endpoint and the tamper demo all hash through here, so none of them
 * can disagree about what the fingerprint covers.
 */
import { createHash } from "node:crypto";

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

// The order readings are put in before hashing. Exported because the oracle sorts too, and two
// copies of this rule could drift into producing different fingerprints for the same readings.
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

function requireText(value: string, label: string): string {
  const normalised = value.trim();
  if (!normalised) {
    throw new Error(`${label} must not be empty.`);
  }
  return normalised;
}

function normaliseReading(
  batchId: string,
  reading: HashableTemperatureReading
): CanonicalTemperatureReading {
  const timestamp = new Date(reading.recordedAt.trim());
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`Invalid temperature reading timestamp '${reading.recordedAt}'.`);
  }
  if (!Number.isFinite(reading.celsius)) {
    throw new Error("Temperature reading must be a finite number.");
  }

  return {
    batchId,
    sensorId: requireText(reading.sensorId, "Temperature reading sensor ID"),
    recordedAt: timestamp.toISOString(),
    // Match the oracle's canonical representation exactly.
    celsius: Number(reading.celsius.toFixed(3))
  };
}

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

export function sha256TemperatureReadings(
  batchId: string,
  readings: readonly HashableTemperatureReading[]
): string {
  return createHash("sha256")
    .update(canonicaliseTemperatureReadings(batchId, readings), "utf8")
    .digest("hex");
}
