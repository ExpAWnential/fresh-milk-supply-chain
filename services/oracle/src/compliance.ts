/**
 * Gives the oracle an early view of whether a reading set is inside the safe temperature range.
 *
 * This result is informative only. The Fabric contract applies the same limits independently, and
 * its on-chain verdict is the authoritative outcome used by the rest of the system.
 */
import type { TemperatureStatistics } from "@fresh-milk/storage";

export type ComplianceOutcome = "COMPLIANT" | "UNSAFE";

// The contract independently applies the same limits when it derives the authoritative verdict.
const MIN_SAFE_CELSIUS = 0;
const MAX_SAFE_CELSIUS = 5;

/** Applies the same safe temperature limits that the contract will enforce authoritatively. */
export function assessCompliance(statistics: TemperatureStatistics): ComplianceOutcome {
  return statistics.minCelsius >= MIN_SAFE_CELSIUS && statistics.maxCelsius <= MAX_SAFE_CELSIUS
    ? "COMPLIANT"
    : "UNSAFE";
}
