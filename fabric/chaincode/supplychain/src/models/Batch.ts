/** Ledger representation of a batch, including the state needed to recover from a breach hold. */

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
  readonly origin: string;
  readonly lastKnownLocation: string;
  readonly createdByStakeholderId: string;
  readonly createdTxId: string;
  readonly createdAt: string;
  readonly lastUpdatedByStakeholderId: string;
  readonly lastUpdatedTxId: string;
  readonly lastUpdatedAt: string;
  // Where the batch was when a cold-chain breach put it on hold. A breach can happen at any stage,
  // so clearing the hold has to return the batch to where it actually was rather than assuming it
  // was in transit. Absent unless a breach is currently open.
  readonly statusBeforeBreach?: BatchStatus;
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
