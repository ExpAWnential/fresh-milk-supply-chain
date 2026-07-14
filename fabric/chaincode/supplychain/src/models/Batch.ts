export type BatchStatus =
  | "CREATED"
  | "COLLECTED"
  | "PROCESSED"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "RECALLED"
  | "COLD_CHAIN_BREACH";

export interface Batch {
  readonly batchId: string;
  readonly status: BatchStatus;
  readonly createdByStakeholderId: string;
  readonly createdTxId: string;
  readonly createdAt: string;
}
