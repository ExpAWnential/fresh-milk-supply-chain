// Every status is produced by a transaction on BatchLifecycleContract or
// TemperatureComplianceContract. IN_TRANSIT has two sources: starting transport, and a regulator
// clearing a cold-chain breach, which returns the batch to where it was. Statuses with no
// transaction that can produce them are not modelled.
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
  // Where the milk came from. Set once at creation and never changed, so the consumer-facing
  // view can name the source without exposing who recorded each step.
  readonly origin: string;
  // Where the batch was when its most recent step was recorded. Each history entry holds the
  // whole record, so the sequence of entries shows the batch moving.
  readonly lastKnownLocation: string;
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
