/** Ledger representation of a consortium identity and its immutable audit provenance. */
export type StakeholderRole =
  "REGULATOR" | "FARM" | "PROCESSOR" | "LOGISTICS" | "RETAILER" | "ORACLE";

export interface Stakeholder {
  readonly stakeholderId: string;
  readonly role: StakeholderRole;
  readonly certificateId: string;
  readonly active: boolean;
  readonly createdTxId: string;
  readonly createdAt: string;
  readonly createdByCertificateId: string;
  readonly updatedTxId: string;
  readonly updatedAt: string;
  readonly updatedByCertificateId: string;
}
