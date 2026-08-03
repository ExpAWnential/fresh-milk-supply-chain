/**
 * Serves the regulator's off-chain verdict archive after Fabric authorises access to the batch.
 * Other organisations intentionally have no archive and report that capability as unavailable.
 */
import { Router } from "express";
import type { VerdictRepository } from "@fresh-milk/storage";
import { config } from "../config.js";
import { BATCH_CONTRACT } from "../fabric/contracts.js";
import { bindLedger } from "../fabric/ledger.js";
import { sendGatewayError, type GatewayConnector } from "../fabric/connection.js";

export function createVerdictRouter(
  connect: GatewayConnector,
  verdictRepository?: Pick<VerdictRepository, "listVerdictsForBatch">
): Router {
  const batches = bindLedger(connect, config.supplychainChaincodeName, BATCH_CONTRACT);
  const router = Router();

  router.get("/batches/:batchId", async (req, res) => {
    if (!verdictRepository) {
      res.status(503).json({ error: "no compliance archive is kept here" });
      return;
    }

    try {
      // Reading the batch off the ledger first is how this borrows the contract's own check on
      // who may look, the same way the evidence listing does.
      await batches.evaluateJson("getBatch", req.params.batchId);
      res.json(await verdictRepository.listVerdictsForBatch(req.params.batchId));
    } catch (error) {
      sendGatewayError(res, error);
    }
  });

  return router;
}
