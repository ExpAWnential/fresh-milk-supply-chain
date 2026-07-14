import { CanonicalTemperatureReading } from "./canonicalise.js";

export interface TemperatureStatistics {
  readonly minCelsius: number;
  readonly maxCelsius: number;
  readonly averageCelsius: number;
  readonly readingCount: number;
}

export type ComplianceOutcome = "COMPLIANT" | "UNSAFE";

export function calculateStatistics(_readings: readonly CanonicalTemperatureReading[]): TemperatureStatistics {
  // TODO: Calculate deterministic min, max, average and count values.
  throw new Error("calculateStatistics is not implemented yet.");
}

export function assessCompliance(_statistics: TemperatureStatistics): ComplianceOutcome {
  // TODO: Apply the chosen cold-chain threshold rules.
  throw new Error("assessCompliance is not implemented yet.");
}
