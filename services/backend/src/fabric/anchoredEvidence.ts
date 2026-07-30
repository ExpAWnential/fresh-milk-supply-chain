import type { Request as ExpressRequest } from "express";
import { config } from "../config.js";
import { resolveDemoIdentity } from "../demoIdentity.js";
import { createFabricGatewayClient } from "./gateway.js";
import { TEMPERATURE_CONTRACT } from "../routes/temperature.js";
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
export function createReaderForRequest(request: ExpressRequest): AnchoredEvidenceReader {
  const identity = resolveDemoIdentity(request);

  return {
    async getAnchoredEvidence(evidenceId: string): Promise<AnchoredEvidence | undefined> {
      const client = await createFabricGatewayClient(identity);
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

function describesMissingEvidence(error: unknown): boolean {
  const details = (error as { details?: readonly { message?: string }[] })?.details;
  const messages = [
    ...(Array.isArray(details) ? details.map((detail) => detail?.message ?? "") : []),
    error instanceof Error ? error.message : ""
  ];

  return messages.some((message) => /does not exist/i.test(message));
}
