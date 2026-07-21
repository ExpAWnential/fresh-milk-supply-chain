import { Context } from "fabric-contract-api";

// Duplicated from the stakeholder chaincode rather than shared through a workspace package.
// Each chaincode is packaged and installed on the peers as a standalone module, so a
// workspace dependency would not resolve inside the chaincode container.
export type StakeholderRole =
  | "REGULATOR"
  | "FARM"
  | "PROCESSOR"
  | "LOGISTICS"
  | "RETAILER"
  | "ORACLE";

export const STAKEHOLDER_CHAINCODE_NAME = "stakeholder";

export interface StakeholderSummary {
  readonly stakeholderId: string;
  readonly role: StakeholderRole;
  readonly active: boolean;
}

export async function getInvokingStakeholder(_ctx: Context): Promise<StakeholderSummary> {
  // TODO: Invoke the stakeholder chaincode to resolve the caller's certificate ID to a stakeholder.
  throw new Error("getInvokingStakeholder is not implemented yet.");
}

export async function assertActiveRole(
  _ctx: Context,
  _allowedRoles: readonly StakeholderRole[]
): Promise<StakeholderSummary> {
  // TODO: Reject the transaction when the caller is unregistered, suspended or holds a disallowed role.
  throw new Error("assertActiveRole is not implemented yet.");
}
