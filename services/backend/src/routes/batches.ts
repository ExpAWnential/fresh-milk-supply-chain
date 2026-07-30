import { Router } from "express";
import { config } from "../config.js";
import { sendGatewayError, withGateway } from "../fabric/request.js";

const CONTRACT = "BatchLifecycleContract";

// The lifecycle steps are separate transactions on the contract, so the request names the event
// and the backend maps it rather than accepting a transaction name from the caller.
const EVENT_TRANSACTIONS: Record<string, string> = {
  PROCESSING: "recordProcessingEvent",
  TRANSPORT: "startTransport",
  DELIVERY: "recordDelivery"
};

export const batchRouter = Router();

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`'${field}' must be a non-empty string.`);
  }
  return value.trim();
}

batchRouter.post("/", async (req, res) => {
  try {
    const batchId = requireString(req.body?.batchId, "batchId");
    const origin = requireString(req.body?.origin, "origin");
    const location = requireString(req.body?.location, "location");
    await withGateway(req, (client) =>
      client.submitTransaction(
        config.supplychainChaincodeName,
        CONTRACT,
        "createBatch",
        batchId,
        origin,
        location
      )
    );
    res.status(201).json({ batchId, origin, location, status: "CREATED" });
  } catch (error) {
    sendGatewayError(res, error);
  }
});

batchRouter.post("/:batchId/events", async (req, res) => {
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
    await withGateway(req, (client) =>
      client.submitTransaction(
        config.supplychainChaincodeName,
        CONTRACT,
        transactionName,
        req.params.batchId,
        location
      )
    );
    res.json({ batchId: req.params.batchId, eventType, location });
  } catch (error) {
    sendGatewayError(res, error);
  }
});

batchRouter.post("/:batchId/recall", async (req, res) => {
  try {
    const reason = requireString(req.body?.reason, "reason");
    await withGateway(req, (client) =>
      client.submitTransaction(
        config.supplychainChaincodeName,
        CONTRACT,
        "recallBatch",
        req.params.batchId,
        reason
      )
    );
    res.json({ batchId: req.params.batchId, status: "RECALLED", reason });
  } catch (error) {
    sendGatewayError(res, error);
  }
});

batchRouter.get("/:batchId", async (req, res) => {
  try {
    const bytes = await withGateway(req, (client) =>
      client.evaluateTransaction(
        config.supplychainChaincodeName,
        CONTRACT,
        "getBatch",
        req.params.batchId
      )
    );
    res.json(JSON.parse(Buffer.from(bytes).toString()));
  } catch (error) {
    sendGatewayError(res, error);
  }
});

batchRouter.get("/:batchId/history", async (req, res) => {
  try {
    const bytes = await withGateway(req, (client) =>
      client.evaluateTransaction(
        config.supplychainChaincodeName,
        CONTRACT,
        "getBatchHistory",
        req.params.batchId
      )
    );
    res.json(JSON.parse(Buffer.from(bytes).toString()));
  } catch (error) {
    sendGatewayError(res, error);
  }
});
