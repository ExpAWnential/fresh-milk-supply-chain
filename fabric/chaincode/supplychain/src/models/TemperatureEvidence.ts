/**
 * The shape of one anchored temperature record.
 *
 * Only the fingerprint, the summary statistics and the verdict are held on the ledger. The raw
 * readings they were computed from stay in PostgreSQL.
 */
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
  // Derived on-chain from the statistics, not supplied by the oracle.
  readonly complianceOutcome: ComplianceOutcome;
  readonly submittedByStakeholderId: string;
  readonly submittedTxId: string;
  readonly submittedAt: string;
}
