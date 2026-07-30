import { Router } from "express";
import { config } from "../config.js";
import type { FabricGatewayClient } from "../fabric/gateway.js";
import { sendGatewayError } from "../fabric/request.js";
import { BATCH_CONTRACT } from "./batches.js";
import { consumerView, type LedgerBatch, type LedgerHistoryEntry } from "../services/consumerView.js";

// Consumers are not members of the Fabric network. They read a filtered view of a batch through
// this endpoint instead of holding a blockchain identity, so the request carries no identity
// header and the backend reads the ledger on their behalf.
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
      sendGatewayError(res, error);
    } finally {
      client?.close();
    }
  });

  return router;
}
