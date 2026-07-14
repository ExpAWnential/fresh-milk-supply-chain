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
}
