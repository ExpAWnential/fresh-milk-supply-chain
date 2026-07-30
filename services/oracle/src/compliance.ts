import { CanonicalTemperatureReading } from "./canonicalise.js";

export interface TemperatureStatistics {
  readonly minCelsius: number;
  readonly maxCelsius: number;
  readonly averageCelsius: number;
  readonly readingCount: number;
}

export type ComplianceOutcome = "COMPLIANT" | "UNSAFE";

// Must stay identical to TemperatureComplianceContract, which re-derives the outcome on-chain.
// If these drift, the oracle's reported result contradicts the ledger.
const MIN_SAFE_CELSIUS = 0;
const MAX_SAFE_CELSIUS = 5;

export function calculateStatistics(
  readings: readonly CanonicalTemperatureReading[]
): TemperatureStatistics {
  if (readings.length === 0) {
    throw new Error("Cannot calculate statistics for an empty reading set.");
  }

  const values = readings.map((reading) => reading.celsius);
  const sum = values.reduce((total, value) => total + value, 0);

  return {
    minCelsius: Number(Math.min(...values).toFixed(3)),
    maxCelsius: Number(Math.max(...values).toFixed(3)),
    averageCelsius: Number((sum / values.length).toFixed(3)),
    readingCount: values.length
  };
}

export function assessCompliance(statistics: TemperatureStatistics): ComplianceOutcome {
  return statistics.minCelsius >= MIN_SAFE_CELSIUS &&
    statistics.maxCelsius <= MAX_SAFE_CELSIUS
    ? "COMPLIANT"
    : "UNSAFE";
}
