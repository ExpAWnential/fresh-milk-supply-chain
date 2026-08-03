/** On-chain evidence summary. Raw sensor readings remain in PostgreSQL. */
export type ComplianceOutcome = "COMPLIANT" | "UNSAFE";

export interface TemperatureStatistics {
  readonly minCelsius: number;
  readonly maxCelsius: number;
  readonly readingCount: number;
}

export interface TemperatureEvidence {
  readonly evidenceId: string;
  readonly batchId: string;
  readonly evidenceHash: string;
  readonly offChainReference: string;
  readonly statistics: TemperatureStatistics;
  // The contract derives this from the statistics instead of trusting the oracle's verdict.
  readonly complianceOutcome: ComplianceOutcome;
  readonly submittedByStakeholderId: string;
  readonly submittedTxId: string;
  readonly submittedAt: string;
}
