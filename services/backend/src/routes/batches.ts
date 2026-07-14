import { Router } from "express";

export const batchRouter = Router();

batchRouter.post("/", (_req, res) => {
  // TODO: Submit BatchLifecycleContract.createBatch through Fabric Gateway.
  res.status(501).json({ error: "create batch endpoint is not implemented yet" });
});

batchRouter.post("/:batchId/events", (_req, res) => {
  // TODO: Map the requested event type to recordProcessingEvent, startTransport or recordDelivery.
  res.status(501).json({ error: "record batch event endpoint is not implemented yet" });
});

batchRouter.post("/:batchId/recall", (_req, res) => {
  // TODO: Submit BatchLifecycleContract.recallBatch through Fabric Gateway.
  res.status(501).json({ error: "recall batch endpoint is not implemented yet" });
});

batchRouter.get("/:batchId", (_req, res) => {
  // TODO: Evaluate BatchLifecycleContract.getBatch through Fabric Gateway.
  res.status(501).json({ error: "get batch endpoint is not implemented yet" });
});

batchRouter.get("/:batchId/history", (_req, res) => {
  // TODO: Evaluate BatchLifecycleContract.getBatchHistory through Fabric Gateway.
  res.status(501).json({ error: "batch history endpoint is not implemented yet" });
});
