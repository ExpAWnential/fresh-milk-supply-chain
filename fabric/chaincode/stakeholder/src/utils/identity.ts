import type { Context } from "fabric-contract-api";

export interface InvokingIdentity {
  // Identifies the specific certificate that signed the transaction
  readonly certificateId: string;
  // Identifies the Fabric organisation that issued or manages that identity
  readonly mspId: string;
}

// Read the real caller from Fabric's verified transaction context
// Do not use identity values supplied in an API request for permission checks
export function getInvokingIdentity(ctx: Context): InvokingIdentity {
  const certificateId = ctx.clientIdentity.getID()?.trim();
  const mspId = ctx.clientIdentity.getMSPID()?.trim();

  // Permission checks cannot be trusted if Fabric did not provide either value.
  if (!certificateId) {
    throw new Error("The invoking Fabric identity does not have a certificate ID.");
  }

  if (!mspId) {
    throw new Error("The invoking Fabric identity does not have an MSP ID.");
  }

  // Both values are now present, so callers can safely use this identity.
  return {
    certificateId,
    mspId
  };
}
