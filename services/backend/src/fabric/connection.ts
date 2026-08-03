/**
 * Owns request-scoped Fabric connections and translates gateway failures for the HTTP API.
 *
 * Contract refusals remain readable client errors. Peer, orderer and programming failures stay
 * server errors so an infrastructure outage is never presented as a rejected business request.
 */
import type { Response } from "express";
import type { OrganisationIdentity } from "../organisations.js";
import { createFabricGatewayClient, type FabricGatewayClient } from "./gateway.js";

// Each request connects with the process's single fixed identity.
export type GatewayConnector = () => Promise<FabricGatewayClient>;

export const connectAs =
  (identity: OrganisationIdentity): GatewayConnector =>
  () =>
    createFabricGatewayClient(identity);

/** Runs request work with a fresh gateway and always closes the connection afterwards. */
export async function withGateway<T>(
  connect: GatewayConnector,
  work: (client: FabricGatewayClient) => Promise<T>
): Promise<T> {
  const client = await connect();
  try {
    return await work(client);
  } finally {
    client.close();
  }
}

interface GatewayErrorDetail {
  readonly message?: string;
}

// Extract the contract's message from Fabric endorsement details when present.
export function extractChaincodeMessage(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const details = (error as { details?: readonly GatewayErrorDetail[] }).details;
  if (Array.isArray(details)) {
    const message = details.find((detail) => detail?.message)?.message?.trim();
    if (message) {
      return stripTransportPrefix(message);
    }
  }

  // Transport errors have no contract detail and must remain server failures.
  if (isTransportFailure(error)) {
    return undefined;
  }

  return error instanceof Error ? stripTransportPrefix(error.message) : undefined;
}

// A numeric gRPC code identifies infrastructure failure rather than contract refusal.
function isTransportFailure(error: unknown): boolean {
  if (typeof (error as { code?: unknown }).code === "number") {
    return true;
  }

  return error instanceof Error && /^\d+ [A-Z_]+:/.test(error.message);
}

// Remove the peer's transport prefix from the user-facing contract message.
function stripTransportPrefix(message: string): string | undefined {
  return message.replace(/^chaincode response \d+,\s*/i, "").trim() || undefined;
}

// Contract refusals are client errors. All other failures are backend faults.
export function sendGatewayError(response: Response, error: unknown): void {
  // A TypeError and friends can only come from a defect in this service. Reporting one as a
  // rejected transaction would send the caller off fixing a request that was never the problem.
  if (error instanceof TypeError || error instanceof RangeError || error instanceof ReferenceError) {
    console.error("Backend fault while handling a Fabric request.", error);
    response.status(500).json({ error: "the request could not be completed" });
    return;
  }

  const message = extractChaincodeMessage(error);
  if (message) {
    response.status(400).json({ error: message });
    return;
  }

  console.error("Fabric gateway request failed.", error);
  response.status(502).json({ error: "the blockchain network could not be reached" });
}
