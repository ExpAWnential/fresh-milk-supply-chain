import { Router } from "express";

export const temperatureRouter = Router();

temperatureRouter.post("/:batchId/evidence", (_req, res) => {
  // TODO: Submit TemperatureComplianceContract.submitTemperatureEvidence through Fabric Gateway.
  res.status(501).json({ error: "submit temperature evidence endpoint is not implemented yet" });
});
