/**
 * Binds routes to a known Fabric chaincode and contract.
 * Callers choose only a transaction and its arguments, while connection cleanup stays centralised.
 */
import { withGateway, type GatewayConnector } from "./connection.js";

export interface BoundLedger {
  submit(transaction: string, ...args: string[]): Promise<void>;
  evaluateJson(transaction: string, ...args: string[]): Promise<unknown>;
}

export function bindLedger(
  connect: GatewayConnector,
  chaincodeName: string,
  contractName: string
): BoundLedger {
  return {
    async submit(transaction, ...args) {
      await withGateway(connect, (client) =>
        client.submitTransaction(chaincodeName, contractName, transaction, ...args)
      );
    },

    async evaluateJson(transaction, ...args) {
      const bytes = await withGateway(connect, (client) =>
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
