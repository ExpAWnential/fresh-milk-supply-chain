import type { Request as ExpressRequest } from "express";
import { config } from "../config.js";
import { resolveDemoIdentity, type DemoIdentity } from "../demoIdentity.js";
import { createFabricGatewayClient, type FabricGatewayClient } from "./gateway.js";
import { TEMPERATURE_CONTRACT } from "./contracts.js";
import type {
  AnchoredEvidence,
  AnchoredEvidenceReader
} from "../services/evidenceVerification.js";

// Without this reader, verification compares the database's stored hash against the database's own
// readings, which proves nothing. Reading the hash back off the ledger is what makes tampering
// detectable, so the comparison is against a record no single party can rewrite.
//
// It runs as the caller, so the contract decides who may read the anchored evidence rather than
// the backend granting it to anyone who asks.
// The connector is a parameter for the same reason every route takes one: it is the seam that
// lets this be exercised without a live network.
export function createReaderForRequest(
  request: ExpressRequest,
  connect: (identity: DemoIdentity) => Promise<FabricGatewayClient> = createFabricGatewayClient
): AnchoredEvidenceReader {
  const identity = resolveDemoIdentity(request);

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
        const anchored = JSON.parse(Buffer.from(bytes).toString()) as {
          evidenceHash: string;
          submittedTxId: string;
        };

        return {
          evidenceHash: anchored.evidenceHash,
          fabricTransactionId: anchored.submittedTxId
        };
      } catch (error) {
        // Only the contract saying the evidence is unknown means "never anchored". A peer being
        // unreachable, or the caller's role being refused, must surface as a failure rather than
        // be reported as absent evidence, which would read as a clean verification result.
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

  // Matched against the contract's exact wording for absent evidence. A bare "does not exist"
  // also covers the stakeholder registry, whose errors reach this call because reading the
  // evidence resolves the caller first, and treating a broken registry entry as missing evidence
  // would tell an auditor nothing was ever anchored.
  return messages.some((message) => /Temperature evidence '[^']*' does not exist/i.test(message));
}
