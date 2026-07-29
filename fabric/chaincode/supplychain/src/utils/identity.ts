import type { Context } from "fabric-contract-api";

export interface InvokingIdentity {
  readonly certificateId: string;
  readonly mspId: string;
}

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
