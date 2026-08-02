/**
 * Who Fabric says is calling. Reads the caller's certificate and MSP out of the verified
 * transaction context.
 */
import type { Context } from "fabric-contract-api";

export interface InvokingIdentity {
  readonly certificateId: string;
  readonly mspId: string;
}

// Read from Fabric's verified transaction context, never from anything the request said about
// itself. This is the only thing a permission check may be based on.
//
// Deliberately duplicated in the other chaincode package rather than shared. The peer builds each
// package on its own from a staged copy, and a workspace dependency would arrive there as a link
// that resolves to nothing. Keep the two files identical so a diff shows any drift at once.
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
