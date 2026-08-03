/**
 * The storage package's public surface. Other packages import from here rather than reaching into
 * its files, so what is shared stays a deliberate choice.
 */
export { createPool, ORACLE_DATABASE_URL, REGULATOR_DATABASE_URL } from "./pool.js";
export {
  compareTemperatureReadings,
  normaliseRecordedAt,
  requireText,
  roundCelsius,
  sha256TemperatureReadings
} from "./evidenceHash.js";
export { calculateTemperatureStatistics } from "./evidenceStatistics.js";
export type { TemperatureStatistics } from "./evidenceStatistics.js";
export { sensorPublicKey, signReading, verifyReadingSignature } from "./sensorSignature.js";
export type { SignableReading } from "./sensorSignature.js";
export { createTemperatureRepository } from "./repositories/temperatureRepository.js";
export type {
  StoredTemperatureReading,
  TemperatureRepository
} from "./repositories/temperatureRepository.js";
export { createVerdictRepository } from "./repositories/verdictRepository.js";
export type {
  ComplianceEventName,
  ArchivedVerdict,
  LedgerComplianceVerdict,
  SignatureCheck,
  VerdictRepository
} from "./repositories/verdictRepository.js";
