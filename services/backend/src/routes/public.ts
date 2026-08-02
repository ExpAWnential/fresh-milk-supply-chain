/**
 * The one endpoint a shopper can reach.
 *
 * Consumers hold no Fabric identity, so this route reads the ledger on their behalf and returns
 * only the filtered view, in wording written for them rather than for an operator.
 */
import { Router, type Response } from "express";
import { config } from "../config.js";
import { BATCH_CONTRACT } from "../fabric/contracts.js";
import type { FabricGatewayClient } from "../fabric/gateway.js";
import { extractChaincodeMessage } from "../fabric/request.js";
import { consumerView, type LedgerBatch, type LedgerHistoryEntry } from "../services/consumerView.js";

// Opens a connection under the backend's own identity rather than the caller's, because the
// request carries no identity header for this route.
export type PublicReader = () => Promise<FabricGatewayClient>;

export function createPublicRouter(readAsRegulator: PublicReader): Router {
  const router = Router();

  router.get("/batches/:batchId", async (req, res) => {
    // Inside the try, so a connection failure is reported rather than escaping the handler.
    let client: FabricGatewayClient | undefined;
    try {
      client = await readAsRegulator();
      const read = async (transaction: string): Promise<unknown> => {
        const bytes = await client!.evaluateTransaction(
          config.supplychainChaincodeName,
          BATCH_CONTRACT,
          transaction,
          req.params.batchId
        );
        return JSON.parse(Buffer.from(bytes).toString());
      };

      // Neither read depends on the other, and the public page is the most expensive request in
      // the system, so they go together.
      const [batch, history] = await Promise.all([
        read("getBatch") as Promise<LedgerBatch>,
        read("getBatchHistory") as Promise<readonly LedgerHistoryEntry[]>
      ]);

      res.json(consumerView(batch, history));
    } catch (error) {
      sendPublicError(res, error);
    } finally {
      client?.close();
    }
  });

  return router;
}

// The contract's own wording never reaches a consumer. It names stakeholders and registry state,
// which is exactly what consumerView strips out of the successful response, and it is written for
// an operator rather than someone holding a carton of milk.
function sendPublicError(response: Response, error: unknown): void {
  const message = extractChaincodeMessage(error);
  if (message && /^Batch '.*' does not exist\.?$/i.test(message)) {
    response
      .status(404)
      .json({ error: "We could not find that batch code. Check the code on the pack and try again." });
    return;
  }

  console.error("Public batch lookup failed.", error);
  response
    .status(502)
    .json({ error: "Batch information is unavailable right now. Please try again shortly." });
}
