import { Router } from "express";

export const batchRouter = Router();

batchRouter.post("/", (_req, res) => {
  // TODO: Submit BatchLifecycleContract.createBatch through Fabric Gateway.
  res.status(501).json({ error: "create batch endpoint is not implemented yet" });
});

batchRouter.post("/:batchId/lifecycle", (_req, res) => {
  // TODO: Submit BatchLifecycleContract.advanceLifecycle through Fabric Gateway.
  res.status(501).json({ error: "advance lifecycle endpoint is not implemented yet" });
});

batchRouter.post("/:batchId/recall", (_req, res) => {
  // TODO: Submit BatchLifecycleContract.recallBatch through Fabric Gateway.
  res.status(501).json({ error: "recall batch endpoint is not implemented yet" });
});
