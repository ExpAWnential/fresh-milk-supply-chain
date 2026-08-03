/**
 * Reads the immutable evidence anchor used by independent verification.
 *
 * A genuine contract response saying that evidence is absent maps to `undefined`. Registry errors,
 * peer outages and malformed ledger data remain failures because none of them proves absence.
 */
import { config } from "../config.js";
import type { OrganisationIdentity } from "../organisations.js";
import { createFabricGatewayClient, type FabricGatewayClient } from "./gateway.js";
import { TEMPERATURE_CONTRACT } from "./contracts.js";
import type { TemperatureStatistics } from "@fresh-milk/storage";
import type { AnchoredEvidence, AnchoredEvidenceReader } from "../services/evidenceVerification.js";

interface AnchoredEvidenceRecord {
  readonly batchId: string;
  readonly evidenceHash: string;
  readonly submittedTxId: string;
  readonly statistics?: TemperatureStatistics;
}

/** Creates a reader bound to the local organisation so Fabric applies its normal access rules. */
export function createAnchoredEvidenceReader(
  identity: OrganisationIdentity,
  connect: (
    identity: OrganisationIdentity
  ) => Promise<FabricGatewayClient> = createFabricGatewayClient
): AnchoredEvidenceReader {
  return {
    async getAnchoredEvidence(evidenceId: string): Promise<AnchoredEvidence | undefined> {
      const client = await connect(identity);
      try {
        const bytes = await client.evaluateTransaction(
          config.supplychainChaincodeName,
          TEMPERATURE_CONTRACT,
          "getTemperatureEvidence",
          evidenceId
        );
        const anchored = JSON.parse(Buffer.from(bytes).toString()) as AnchoredEvidenceRecord;

        return {
          batchId: anchored.batchId,
          evidenceHash: anchored.evidenceHash,
          fabricTransactionId: anchored.submittedTxId,
          // The summary is checked separately because the evidence hash does not cover it.
          statistics: anchored.statistics
        };
      } catch (error) {
        // Only the contract's missing-evidence response maps to undefined.
        if (describesMissingEvidence(error)) {
          return undefined;
        }
        throw error;
      } finally {
        client.close();
      }
    }
  };
}

export function describesMissingEvidence(error: unknown): boolean {
  const details = (error as { details?: readonly { message?: string }[] })?.details;
  const messages = [
    ...(Array.isArray(details) ? details.map((detail) => detail?.message ?? "") : []),
    error instanceof Error ? error.message : ""
  ];

  // Match the evidence-specific message without hiding stakeholder registry failures.
  return messages.some((message) => /Temperature evidence '[^']*' does not exist/i.test(message));
}
