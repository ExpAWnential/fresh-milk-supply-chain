import { Router } from "express";

export const stakeholderRouter = Router();

stakeholderRouter.post("/", (_req, res) => {
  // TODO: Submit StakeholderRegistryContract.registerStakeholder through Fabric Gateway.
  res.status(501).json({ error: "register stakeholder endpoint is not implemented yet" });
});

stakeholderRouter.patch("/:stakeholderId", (_req, res) => {
  // TODO: Submit StakeholderRegistryContract.updateStakeholder through Fabric Gateway.
  res.status(501).json({ error: "update stakeholder endpoint is not implemented yet" });
});

stakeholderRouter.post("/:stakeholderId/suspend", (_req, res) => {
  // TODO: Submit StakeholderRegistryContract.suspendStakeholder through Fabric Gateway.
  res.status(501).json({ error: "suspend stakeholder endpoint is not implemented yet" });
});
