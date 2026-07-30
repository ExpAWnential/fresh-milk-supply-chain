/**
 * The supply-chain chaincode's door into the stakeholder registry.
 *
 * It invokes the registry's `assertActiveRole` across chaincodes and then re-checks the answer
 * here, so a malformed or unexpected response still cannot let the wrong role through.
 */
import type { Context } from "fabric-contract-api";
import { getInvokingIdentity } from "./identity.js";

export type StakeholderRole =
  | "REGULATOR"
  | "FARM"
  | "PROCESSOR"
  | "LOGISTICS"
  | "RETAILER"
  | "ORACLE";

const STAKEHOLDER_CHAINCODE_NAME = "stakeholder";
const STAKEHOLDER_ROLE_ASSERTION_TRANSACTION =
  "StakeholderRegistryContract:assertActiveRole";

const ALL_ROLES: readonly StakeholderRole[] = [
  "REGULATOR",
  "FARM",
  "PROCESSOR",
  "LOGISTICS",
  "RETAILER",
  "ORACLE"
];

export interface StakeholderSummary {
  readonly stakeholderId: string;
  readonly role: StakeholderRole;
  readonly active: boolean;
}

export async function getInvokingStakeholder(ctx: Context): Promise<StakeholderSummary> {
  return assertActiveRole(ctx, ALL_ROLES);
}

export async function assertActiveRole(
  ctx: Context,
  allowedRoles: readonly StakeholderRole[]
): Promise<StakeholderSummary> {
  if (allowedRoles.length === 0) {
    throw new Error("At least one allowed stakeholder role is required.");
  }

  const identity = getInvokingIdentity(ctx);
  const response = await ctx.stub.invokeChaincode(
    STAKEHOLDER_CHAINCODE_NAME,
    [
      STAKEHOLDER_ROLE_ASSERTION_TRANSACTION,
      identity.certificateId,
      JSON.stringify([...new Set(allowedRoles)])
    ],
    ""
  );

  if (response.status !== 200) {
    const message = response.message?.trim() || response.payload?.toString().trim();
    throw new Error(
      message || "The stakeholder registry rejected the caller's authorisation request."
    );
  }

  if (!response.payload || response.payload.length === 0) {
    throw new Error("The stakeholder registry returned an empty authorisation response.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.payload.toString());
  } catch {
    throw new Error("The stakeholder registry returned an invalid authorisation response.");
  }
  if (!isStakeholderSummary(parsed)) {
    throw new Error("The stakeholder registry returned an incomplete authorisation response.");
  }

  if (!allowedRoles.includes(parsed.role)) {
    throw new Error(
      `Stakeholder '${parsed.stakeholderId}' has role '${parsed.role}', ` +
        `but this operation requires one of: ${allowedRoles.join(", ")}.`
    );
  }
  if (!parsed.active) {
    throw new Error(`Stakeholder '${parsed.stakeholderId}' is suspended.`);
  }

  return parsed;
}

function isStakeholderSummary(value: unknown): value is StakeholderSummary {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<StakeholderSummary>;
  return (
    typeof candidate.stakeholderId === "string" &&
    candidate.stakeholderId.trim().length > 0 &&
    ALL_ROLES.includes(candidate.role as StakeholderRole) &&
    typeof candidate.active === "boolean"
  );
}
