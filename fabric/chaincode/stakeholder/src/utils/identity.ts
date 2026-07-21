import { Context } from "fabric-contract-api";

export interface InvokingIdentity {
  readonly certificateId: string;
  readonly mspId: string;
}

export function getInvokingIdentity(_ctx: Context): InvokingIdentity {
  // TODO: Extract the authenticated Fabric certificate ID and MSP ID from the client identity.
  throw new Error("getInvokingIdentity is not implemented yet.");
}
