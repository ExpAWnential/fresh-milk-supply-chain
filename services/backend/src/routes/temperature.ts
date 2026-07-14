import { Router } from "express";

export const temperatureRouter = Router();

temperatureRouter.post("/batches/:batchId/evidence", (_req, res) => {
  // TODO: Submit TemperatureComplianceContract.submitTemperatureEvidence through Fabric Gateway.
  res.status(501).json({ error: "submit temperature evidence endpoint is not implemented yet" });
});

temperatureRouter.post("/batches/:batchId/resolve-breach", (_req, res) => {
  // TODO: Submit TemperatureComplianceContract.resolveTemperatureBreach through Fabric Gateway.
  res.status(501).json({ error: "resolve breach endpoint is not implemented yet" });
});

temperatureRouter.get("/batches/:batchId/evidence", (_req, res) => {
  // TODO: Return the anchored evidence recorded against this batch.
  res.status(501).json({ error: "batch temperature evidence endpoint is not implemented yet" });
});

temperatureRouter.get("/evidence/:evidenceId", (_req, res) => {
  // TODO: Evaluate TemperatureComplianceContract.getTemperatureEvidence through Fabric Gateway.
  res.status(501).json({ error: "get evidence endpoint is not implemented yet" });
});

temperatureRouter.get("/evidence/:evidenceId/verify", (_req, res) => {
  // TODO: Recompute the hash from the off-chain readings and compare it with the anchored hash.
  res.status(501).json({ error: "verify evidence endpoint is not implemented yet" });
});
