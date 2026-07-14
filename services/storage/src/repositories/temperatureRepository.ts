import { Pool } from "pg";

export type ComplianceOutcome = "COMPLIANT" | "UNSAFE";
export type SubmissionStatus = "PENDING" | "ANCHORED" | "FAILED";

export interface StoredTemperatureReading {
  readonly sensorId: string;
  readonly recordedAt: string;
  readonly celsius: number;
}

export interface StoredTemperatureEvidence {
  readonly evidenceId: string;
  readonly batchId: string;
  readonly sensorId: string;
  readonly evidenceHash: string;
  readonly minCelsius: number;
  readonly maxCelsius: number;
  readonly averageCelsius: number;
  readonly readingCount: number;
  readonly complianceOutcome: ComplianceOutcome;
  readonly submissionStatus: SubmissionStatus;
  readonly fabricTransactionId: string | null;
}

export interface TemperatureRepository {
  saveEvidence(
    evidence: StoredTemperatureEvidence,
    readings: readonly StoredTemperatureReading[]
  ): Promise<void>;
  markAnchored(evidenceId: string, fabricTransactionId: string): Promise<void>;
  markFailed(evidenceId: string): Promise<void>;
  getEvidence(evidenceId: string): Promise<StoredTemperatureEvidence | undefined>;
  getReadings(evidenceId: string): Promise<readonly StoredTemperatureReading[]>;
}

export function createTemperatureRepository(_pool: Pool): TemperatureRepository {
  // TODO: Persist evidence and its readings in one transaction, and expose them for hash verification.
  throw new Error("createTemperatureRepository is not implemented yet.");
}
