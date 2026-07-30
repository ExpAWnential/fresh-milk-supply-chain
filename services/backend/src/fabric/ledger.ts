import type { Request } from "express";
import { withGateway, type GatewayConnector } from "./request.js";

// Every route talks to one chaincode and one contract, so binding both once removes them from
// each call site and leaves the handler showing only the transaction it runs.
export interface BoundLedger {
  submit(request: Request, transaction: string, ...args: string[]): Promise<void>;
  evaluateJson(request: Request, transaction: string, ...args: string[]): Promise<unknown>;
}

export function bindLedger(
  connect: GatewayConnector,
  chaincodeName: string,
  contractName: string
): BoundLedger {
  return {
    async submit(request, transaction, ...args) {
      await withGateway(connect, request, (client) =>
        client.submitTransaction(chaincodeName, contractName, transaction, ...args)
      );
    },

    async evaluateJson(request, transaction, ...args) {
      const bytes = await withGateway(connect, request, (client) =>
        client.evaluateTransaction(chaincodeName, contractName, transaction, ...args)
      );
      return JSON.parse(Buffer.from(bytes).toString());
    }
  };
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`'${field}' must be a non-empty string.`);
  }
  return value.trim();
}
