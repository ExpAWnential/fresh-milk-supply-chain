/**
 * Who Fabric says is calling. Reads the caller's certificate and MSP out of the verified
 * transaction context.
 */
import type { Context } from "fabric-contract-api";

export interface InvokingIdentity {
  readonly certificateId: string;
  readonly mspId: string;
}

// Chaincode packages are staged independently, so security helpers remain local instead of using a
// workspace dependency that would become a broken link inside the peer builder.
/** Reads only Fabric's authenticated context, never identity fields supplied by the request. */
export function getInvokingIdentity(ctx: Context): InvokingIdentity {
  const certificateId = ctx.clientIdentity.getID()?.trim();
  const mspId = ctx.clientIdentity.getMSPID()?.trim();

  if (!certificateId) {
    throw new Error("The invoking Fabric identity does not have a certificate ID.");
  }
  if (!mspId) {
    throw new Error("The invoking Fabric identity does not have an MSP ID.");
  }

  return { certificateId, mspId };
}
