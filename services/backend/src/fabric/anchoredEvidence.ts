/**
 * Reads an anchored evidence hash back off the ledger.
 *
 * Verification needs an anchor from outside the database it is checking, and this is the only
 * place that anchor comes from.
 */
import { config } from "../config.js";
import type { OrganisationIdentity } from "../organisations.js";
import { createFabricGatewayClient, type FabricGatewayClient } from "./gateway.js";
import { TEMPERATURE_CONTRACT } from "./contracts.js";
import type { TemperatureStatistics } from "@fresh-milk/storage";
import type {
  AnchoredEvidence,
  AnchoredEvidenceReader
} from "../services/evidenceVerification.js";

// The parts of the ledger's evidence record this reader uses.
interface AnchoredEvidenceRecord {
  readonly batchId: string;
  readonly evidenceHash: string;
  readonly submittedTxId: string;
  readonly statistics?: TemperatureStatistics;
}

// Without this reader, verification compares the database's stored hash against the database's own
// readings, which proves nothing. Reading the hash back off the ledger is what makes tampering
// detectable, so the comparison is against a record no single party can rewrite.
//
// It reads as this company, using this process's own certificate, so what it can see is whatever
// the contract allows that company to see.
// The connector is a parameter for the same reason every route takes one: it is the seam that
// lets this be exercised without a live network.
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
          // Taken from the ledger rather than from whoever holds the readings, so recomputing the
          // fingerprint does not depend on the party being checked.
          batchId: anchored.batchId,
          evidenceHash: anchored.evidenceHash,
          fabricTransactionId: anchored.submittedTxId,
          // The summary the contract judged. Carried through so verification can check it against
          // the readings, which the hash on its own cannot do.
          statistics: anchored.statistics
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
