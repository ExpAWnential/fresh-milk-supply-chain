import { CanonicalTemperatureReading } from "./canonicalise.js";

export interface TemperatureStatistics {
  readonly minCelsius: number;
  readonly maxCelsius: number;
  readonly averageCelsius: number;
  readonly readingCount: number;
}

export type ComplianceOutcome = "COMPLIANT" | "UNSAFE";

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
  return statistics.maxCelsius <= 4 ? "COMPLIANT" : "UNSAFE";
}
