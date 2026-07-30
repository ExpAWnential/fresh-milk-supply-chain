import { Router } from "express";
import { config } from "../config.js";
import { BATCH_CONTRACT } from "../fabric/contracts.js";
import { bindLedger, requireString } from "../fabric/ledger.js";
import { sendGatewayError, type GatewayConnector } from "../fabric/request.js";

// The lifecycle steps are separate transactions on the contract, so the request names the event
// and the backend maps it rather than accepting a transaction name from the caller.
const EVENT_TRANSACTIONS: Record<string, string> = {
  PROCESSING: "recordProcessingEvent",
  TRANSPORT: "startTransport",
  DELIVERY: "recordDelivery"
};

export function createBatchRouter(connect: GatewayConnector): Router {
  const batches = bindLedger(connect, config.supplychainChaincodeName, BATCH_CONTRACT);
  const router = Router();

  router.post("/", async (req, res) => {
    try {
      const batchId = requireString(req.body?.batchId, "batchId");
      const origin = requireString(req.body?.origin, "origin");
      const location = requireString(req.body?.location, "location");

      await batches.submit(req, "createBatch", batchId, origin, location);
      res.status(201).json({ batchId, origin, location, status: "CREATED" });
    } catch (error) {
      sendGatewayError(res, error);
    }
  });

  // Declared before the single-batch route so a status query is not read as a batch called
  // "status". This is the lookup CouchDB was chosen for: without it the rich query the contract
  // runs has no way of being reached.
  router.get("/", async (req, res) => {
    try {
      const status = requireString(req.query?.status, "status");
      res.json(await batches.evaluateJson(req, "queryBatchesByStatus", status));
    } catch (error) {
      sendGatewayError(res, error);
    }
  });

  router.post("/:batchId/events", async (req, res) => {
    try {
      const eventType = requireString(req.body?.eventType, "eventType").toUpperCase();
      const transactionName = EVENT_TRANSACTIONS[eventType];
      if (!transactionName) {
        res.status(400).json({
          error: `Unknown eventType '${eventType}'. Expected one of: ${Object.keys(EVENT_TRANSACTIONS).join(", ")}.`
        });
        return;
      }

      const location = requireString(req.body?.location, "location");
      await batches.submit(req, transactionName, req.params.batchId, location);
      res.json({ batchId: req.params.batchId, eventType, location });
    } catch (error) {
      sendGatewayError(res, error);
    }
  });

  router.post("/:batchId/recall", async (req, res) => {
    try {
      const reason = requireString(req.body?.reason, "reason");
      await batches.submit(req, "recallBatch", req.params.batchId, reason);
      res.json({ batchId: req.params.batchId, status: "RECALLED", reason });
    } catch (error) {
      sendGatewayError(res, error);
    }
  });

  router.get("/:batchId", async (req, res) => {
    try {
      res.json(await batches.evaluateJson(req, "getBatch", req.params.batchId));
    } catch (error) {
      sendGatewayError(res, error);
    }
  });

  router.get("/:batchId/history", async (req, res) => {
    try {
      res.json(await batches.evaluateJson(req, "getBatchHistory", req.params.batchId));
    } catch (error) {
      sendGatewayError(res, error);
    }
  });

  return router;
}
