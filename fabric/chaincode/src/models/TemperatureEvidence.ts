export type ComplianceOutcome = "COMPLIANT" | "UNSAFE";

export interface TemperatureStatistics {
  readonly minCelsius: number;
  readonly maxCelsius: number;
  readonly averageCelsius: number;
  readonly readingCount: number;
}

export interface TemperatureEvidence {
  readonly batchId: string;
  readonly evidenceHash: string;
  readonly offChainReference: string;
  readonly statistics: TemperatureStatistics;
  readonly complianceOutcome: ComplianceOutcome;
}
