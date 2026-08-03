/**
 * Reads a sensor's registered public key back off the ledger.
 *
 * Verification needs a key from somewhere the party being checked cannot rewrite. Taking it from
 * the company that holds the readings would mean checking their data against their own copy of the
 * key, which proves nothing at all; the regulator's attestation on the ledger is the part they
 * cannot forge.
 *
 * It reads as this company, with this process's own certificate, so what it can see is whatever the
 * contract allows that company to see.
 */
import { config } from "../config.js";
import type { OrganisationIdentity } from "../organisations.js";
import { extractChaincodeMessage } from "./connection.js";
import { createFabricGatewayClient, type FabricGatewayClient } from "./gateway.js";
import { STAKEHOLDER_CONTRACT } from "./contracts.js";
import type { RegisteredSensorKey, SensorKeyReader } from "../services/evidenceVerification.js";

// Only the contract saying it holds no key means "unregistered". A peer that could not be reached
// says nothing either way, and reporting it as absent would let an unreachable ledger turn an
// unverifiable reading into a definite verdict.
export function describesMissingSensorKey(error: unknown): boolean {
  const message = extractChaincodeMessage(error);
  return message !== undefined && /Sensor '[^']*' has no registered key/i.test(message);
}

export function createSensorKeyReader(
  identity: OrganisationIdentity,
  connect: (
    identity: OrganisationIdentity
  ) => Promise<FabricGatewayClient> = createFabricGatewayClient
): SensorKeyReader {
  return {
    async getSensorKey(sensorId: string): Promise<RegisteredSensorKey | undefined> {
      const client = await connect(identity);
      try {
        const bytes = await client.evaluateTransaction(
          config.stakeholderChaincodeName,
          STAKEHOLDER_CONTRACT,
          "getSensorKey",
          sensorId
        );
        const record = JSON.parse(Buffer.from(bytes).toString()) as RegisteredSensorKey;

        return { publicKey: record.publicKey, active: record.active };
      } catch (error) {
        if (describesMissingSensorKey(error)) {
          return undefined;
        }
        throw error;
      } finally {
        client.close();
      }
    }
  };
}
