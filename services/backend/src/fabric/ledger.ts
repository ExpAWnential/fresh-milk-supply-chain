/**
 * The two things most routes need before they can talk to a contract: a chaincode and contract
 * bound once, and a check that a request field really is a non-empty string.
 */
import { withGateway, type GatewayConnector } from "./connection.js";

// Every route talks to one chaincode and one contract, so binding both once removes them from
// each call site and leaves the handler showing only the transaction it runs.
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
