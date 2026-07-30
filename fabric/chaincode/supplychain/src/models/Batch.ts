// Every status is reachable by exactly one transaction on BatchLifecycleContract or
// TemperatureComplianceContract. Statuses with no transaction that can produce them are
// not modelled.
export const BATCH_STATUSES = [
  "CREATED",
  "PROCESSED",
  "IN_TRANSIT",
  "DELIVERED",
  "RECALLED",
  "COLD_CHAIN_BREACH"
] as const;

export type BatchStatus = (typeof BATCH_STATUSES)[number];

export interface Batch {
  readonly batchId: string;
  readonly status: BatchStatus;
  readonly createdByStakeholderId: string;
  readonly createdTxId: string;
  readonly createdAt: string;
  readonly lastUpdatedByStakeholderId: string;
  readonly lastUpdatedTxId: string;
  readonly lastUpdatedAt: string;
  readonly recallReason?: string;
  readonly recalledByStakeholderId?: string;
  readonly recalledTxId?: string;
  readonly recalledAt?: string;
}

export interface BatchHistoryEntry {
  readonly txId: string;
  readonly timestamp: string;
  readonly isDelete: boolean;
  readonly submittedByStakeholderId: string | null;
  readonly batch: Batch | null;
}
