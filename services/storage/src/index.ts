/**
 * The storage package's public surface. Other packages import from here rather than reaching into
 * its files, so what is shared stays a deliberate choice.
 */
export { createPool } from "./pool.js";
export type { StorageConfig } from "./pool.js";
export { compareTemperatureReadings, sha256TemperatureReadings } from "./evidenceHash.js";
export type { CanonicalTemperatureReading } from "./evidenceHash.js";
export { calculateTemperatureStatistics } from "./evidenceStatistics.js";
export type { TemperatureStatistics } from "./evidenceStatistics.js";
export { createTemperatureRepository } from "./repositories/temperatureRepository.js";
export type {
  ComplianceOutcome,
  StoredTemperatureEvidence,
  StoredTemperatureReading,
  SubmissionStatus,
  TemperatureRepository
} from "./repositories/temperatureRepository.js";
