import { config } from "../config.js";
import { getDemoIdentity } from "../demoIdentity.js";
import { createFabricGatewayClient } from "./gateway.js";
import type {
  AnchoredEvidence,
  AnchoredEvidenceReader
} from "../services/evidenceVerification.js";

// Without this reader, verification compares the database's stored hash against the database's own
// readings, which proves nothing. Reading the hash back off the ledger is what makes tampering
// detectable, so the comparison is against a record no single party can rewrite.
export function createFabricAnchoredEvidenceReader(identityName: string): AnchoredEvidenceReader {
  const identity = getDemoIdentity(identityName);

  return {
    async getAnchoredEvidence(evidenceId: string): Promise<AnchoredEvidence | undefined> {
      const client = await createFabricGatewayClient(identity);
      try {
        const bytes = await client.evaluateTransaction(
          config.supplychainChaincodeName,
          "TemperatureComplianceContract",
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
      } catch {
        // The contract rejects an unknown evidence ID. Reporting it as absent lets the caller
        // distinguish "never anchored" from "anchored but altered".
        return undefined;
      } finally {
        client.close();
      }
    }
  };
}
