import { Request } from "express";

export const DEMO_IDENTITY_HEADER = "x-demo-identity";

// PoC only. The demo selects which enrolled Fabric wallet identity signs the transaction by
// sending a header. A real deployment would authenticate the caller and derive the identity
// from that, never from a client-supplied value.
export function resolveDemoIdentity(_request: Request): string {
  // TODO: Read the demo identity header and map it to an enrolled Fabric wallet identity.
  // TODO: Reject requests naming an unknown identity.
  throw new Error("resolveDemoIdentity is not implemented yet.");
}
