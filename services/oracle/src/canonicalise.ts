/**
 * Puts readings into the one exact form the fingerprint is computed over: trimmed text, ISO
 * timestamps, temperatures to three decimals, in a fixed order.
 *
 * Two runs over the same readings have to produce byte-identical output, or the hash means
 * nothing.
 */
// Every rule that decides what a reading *is* comes from the storage package, which is also where
// the fingerprint and the signed payload are built. Keeping a private copy of any of them here
// would mean the oracle could normalise a timestamp one way, then have the signature checked
// against a payload normalised another way, and report readings nobody touched as forged.
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

// The sequence and the signature are carried through rather than normalised. The sequence is part
// of what the sensor signed, so changing it here would invalidate every signature; the signature
// is opaque bytes. Neither takes part in the ordering, which stays exactly what the fingerprint is
// built from.
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

