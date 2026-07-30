/**
 * Reports whether a reading set sits inside the safe range.
 *
 * This is the oracle's own reading of the data. The contract derives the verdict again on-chain,
 * and that is the one that counts. The statistics themselves come from the storage package, so the
 * numbers anchored here are computed by the same code verification later recomputes them with.
 */
import type { TemperatureStatistics } from "@fresh-milk/storage";

export type ComplianceOutcome = "COMPLIANT" | "UNSAFE";

// Must stay identical to TemperatureComplianceContract, which re-derives the outcome on-chain.
// If these drift, the oracle's reported result contradicts the ledger.
const MIN_SAFE_CELSIUS = 0;
const MAX_SAFE_CELSIUS = 5;

export function assessCompliance(statistics: TemperatureStatistics): ComplianceOutcome {
  return statistics.minCelsius >= MIN_SAFE_CELSIUS &&
    statistics.maxCelsius <= MAX_SAFE_CELSIUS
    ? "COMPLIANT"
    : "UNSAFE";
}
