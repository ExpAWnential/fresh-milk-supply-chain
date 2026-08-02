/**
 * The shape of a stakeholder record as it is stored on the ledger.
 *
 * Types only. Every rule about who may create or change one lives in StakeholderRegistryContract.
 */
export type StakeholderRole =
  | "REGULATOR"
  | "FARM"
  | "PROCESSOR"
  | "LOGISTICS"
  | "RETAILER"
  | "ORACLE";

export interface Stakeholder {
  readonly stakeholderId: string;
  readonly role: StakeholderRole;
  readonly certificateId: string;
  readonly active: boolean;
  // Audit details from the Fabric transaction that first created this stakeholder
  readonly createdTxId: string;
  readonly createdAt: string;
  readonly createdByCertificateId: string;
  // Audit details from the most recent role or status change
  // These initially match the creation details until the stakeholder is updated
  readonly updatedTxId: string;
  readonly updatedAt: string;
  readonly updatedByCertificateId: string;
}
