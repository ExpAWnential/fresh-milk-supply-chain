// Every status is reachable by exactly one transaction on BatchLifecycleContract or
// TemperatureComplianceContract. Statuses with no transaction that can produce them are
// not modelled.
export type BatchStatus =
  | "CREATED"
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
