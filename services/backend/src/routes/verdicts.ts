/**
 * The regulator's archive of what the ledger decided about a batch.
 *
 * Only the regulator's backend has one, because only the regulator runs the event listener that
 * builds it. It is a different database from the oracle's, holding a different thing: the
 * contract's verdicts rather than the readings they were reached from.
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
