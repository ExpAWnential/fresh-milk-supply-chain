/**
 * Computes the temperature summary that is stored on Fabric and used to derive compliance.
 *
 * Submission and later verification share this implementation so they apply exactly the same
 * rounding to the minimum, maximum and reading count.
 */
import { roundCelsius } from "./evidenceHash.js";

export interface TemperatureStatistics {
  readonly minCelsius: number;
  readonly maxCelsius: number;
  readonly readingCount: number;
}

/** Summarises a non-empty reading set using the rounding shared with later verification. */
export function calculateTemperatureStatistics(
  readings: readonly { readonly celsius: number }[]
): TemperatureStatistics {
  if (readings.length === 0) {
    throw new Error("Cannot calculate statistics for an empty reading set.");
  }

  const values = readings.map((reading) => reading.celsius);

  return {
    minCelsius: roundCelsius(Math.min(...values)),
    maxCelsius: roundCelsius(Math.max(...values)),
    readingCount: values.length
  };
}
