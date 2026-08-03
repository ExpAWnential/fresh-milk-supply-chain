/**
 * Reads regulator-attested sensor keys from Fabric for signature verification.
 *
 * Only the contract's explicit missing-key response means a sensor is unregistered. Network and
 * registry failures remain inconclusive because treating them as absence would weaken verification.
 */
import { config } from "../config.js";
import type { OrganisationIdentity } from "../organisations.js";
import { extractChaincodeMessage } from "./connection.js";
import { createFabricGatewayClient, type FabricGatewayClient } from "./gateway.js";
import { STAKEHOLDER_CONTRACT } from "./contracts.js";
import type { RegisteredSensorKey, SensorKeyReader } from "../services/evidenceVerification.js";

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
