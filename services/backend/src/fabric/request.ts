import type { Request, Response } from "express";
import { resolveDemoIdentity } from "../demoIdentity.js";
import { createFabricGatewayClient, type FabricGatewayClient } from "./gateway.js";

// A connection is opened per request rather than pooled. For a proof of concept an obviously
// correct identity per call is worth more than saving a TLS handshake.
export async function withGateway<T>(
  request: Request,
  work: (client: FabricGatewayClient) => Promise<T>
): Promise<T> {
  const client = await createFabricGatewayClient(resolveDemoIdentity(request));
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
function extractChaincodeMessage(error: unknown): string | undefined {
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

  return error instanceof Error ? stripTransportPrefix(error.message) : undefined;
}

// The peer prefixes the contract's message with its own status, which means nothing to a reader.
function stripTransportPrefix(message: string): string | undefined {
  return message.replace(/^chaincode response \d+,\s*/i, "").trim() || undefined;
}

// A rejected transaction is the contract enforcing a rule, so it is reported as a client error.
// Anything without a contract message is treated as a genuine backend fault.
export function sendGatewayError(response: Response, error: unknown): void {
  const message = extractChaincodeMessage(error);
  if (message) {
    response.status(400).json({ error: message });
    return;
  }

  console.error("Fabric gateway request failed.", error);
  response.status(502).json({ error: "the blockchain network could not be reached" });
}
