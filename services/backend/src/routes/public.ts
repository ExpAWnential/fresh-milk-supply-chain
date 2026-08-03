/** Serves a privacy-filtered view through the host organisation's ledger permissions. */
import { Router, type Response } from "express";
import { config } from "../config.js";
import { BATCH_CONTRACT } from "../fabric/contracts.js";
import type { FabricGatewayClient } from "../fabric/gateway.js";
import { extractChaincodeMessage, type GatewayConnector } from "../fabric/connection.js";
import {
  consumerView,
  type LedgerBatch,
  type LedgerHistoryEntry
} from "../services/consumerView.js";

export function createPublicRouter(connect: GatewayConnector): Router {
  const router = Router();

  router.get("/batches/:batchId", async (req, res) => {
    let client: FabricGatewayClient | undefined;
    try {
      client = await connect();
      const read = async (transaction: string): Promise<unknown> => {
        const bytes = await client!.evaluateTransaction(
          config.supplychainChaincodeName,
          BATCH_CONTRACT,
          transaction,
          req.params.batchId
        );
        return JSON.parse(Buffer.from(bytes).toString());
      };

      // Batch state and history are independent reads.
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

// Replace operator-facing contract details with a safe message for shoppers.
function sendPublicError(response: Response, error: unknown): void {
  const message = extractChaincodeMessage(error);
  if (message && /^Batch '.*' does not exist\.?$/i.test(message)) {
    response.status(404).json({
      error: "We could not find that batch code. Check the code on the pack and try again."
    });
    return;
  }

  console.error("Public batch lookup failed.", error);
  response
    .status(502)
    .json({ error: "Batch information is unavailable right now. Please try again shortly." });
}
