/**
 * The summary of a reading set that goes on the ledger and that the contract's verdict is derived
 * from.
 *
 * Shared for the same reason the hash and its comparator are: the oracle computes these before
 * anchoring and verification recomputes them afterwards to check the anchored copy was honest. Two
 * implementations would eventually round differently and report a lie where there was none.
 */

export interface TemperatureStatistics {
  readonly minCelsius: number;
  readonly maxCelsius: number;
  readonly readingCount: number;
}

export function calculateTemperatureStatistics(
  readings: readonly { readonly celsius: number }[]
): TemperatureStatistics {
  if (readings.length === 0) {
    throw new Error("Cannot calculate statistics for an empty reading set.");
  }

  const values = readings.map((reading) => reading.celsius);

  return {
    minCelsius: Number(Math.min(...values).toFixed(3)),
    maxCelsius: Number(Math.max(...values).toFixed(3)),
    readingCount: values.length
  };
}
