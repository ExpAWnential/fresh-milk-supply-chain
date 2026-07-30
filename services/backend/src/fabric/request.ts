import type { Request, Response } from "express";
import { resolveDemoIdentity } from "../demoIdentity.js";
import { createFabricGatewayClient, type FabricGatewayClient } from "./gateway.js";

// Opening the connection is a separate step so routes can be exercised against a stub instead of
// a live network. A connection is made per request rather than pooled: for a proof of concept an
// obviously correct identity per call is worth more than saving a TLS handshake.
export type GatewayConnector = (request: Request) => Promise<FabricGatewayClient>;

export const connectAsRequestIdentity: GatewayConnector = (request) =>
  createFabricGatewayClient(resolveDemoIdentity(request));

export async function withGateway<T>(
  connect: GatewayConnector,
  request: Request,
  work: (client: FabricGatewayClient) => Promise<T>
): Promise<T> {
  const client = await connect(request);
  try {
    return await work(client);
  } finally {
    client.close();
  }
}

interface GatewayErrorDetail {
  readonly message?: string;
}

// Fabric buries the contract's own message inside the gRPC error details. Surfacing that rather
// than "endorsement failure" is what makes a rejected transaction readable.
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

  // Only the details array carries the contract's own words. A transport failure has none, and
  // reading its message as a refusal is what made the unreachable-network response below dead
  // code and told operators with a peer down that their request was malformed.
  if (isTransportFailure(error)) {
    return undefined;
  }

  return error instanceof Error ? stripTransportPrefix(error.message) : undefined;
}

// gRPC reports failures with a numeric status code and a message that leads with it, neither of
// which a contract produces. fabric-gateway's endorsement errors carry a code too, but they are
// already handled above by the details array they also carry.
function isTransportFailure(error: unknown): boolean {
  if (typeof (error as { code?: unknown }).code === "number") {
    return true;
  }

  return error instanceof Error && /^\d+ [A-Z_]+:/.test(error.message);
}

// The peer prefixes the contract's message with its own status, which means nothing to a reader.
function stripTransportPrefix(message: string): string | undefined {
  return message.replace(/^chaincode response \d+,\s*/i, "").trim() || undefined;
}

// A rejected transaction is the contract enforcing a rule, so it is reported as a client error.
// Anything without a contract message is treated as a genuine backend fault.
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
