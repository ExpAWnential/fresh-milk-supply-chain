import { Router } from "express";

export const stakeholderRouter = Router();

stakeholderRouter.post("/", (_req, res) => {
  // TODO: Submit StakeholderRegistryContract.registerStakeholder through Fabric Gateway.
  res.status(501).json({ error: "register stakeholder endpoint is not implemented yet" });
});

stakeholderRouter.patch("/:stakeholderId/role", (_req, res) => {
  // TODO: Submit StakeholderRegistryContract.updateStakeholderRole through Fabric Gateway.
  res.status(501).json({ error: "update stakeholder role endpoint is not implemented yet" });
});

stakeholderRouter.post("/:stakeholderId/suspend", (_req, res) => {
  // TODO: Submit StakeholderRegistryContract.suspendStakeholder through Fabric Gateway.
  res.status(501).json({ error: "suspend stakeholder endpoint is not implemented yet" });
});

stakeholderRouter.post("/:stakeholderId/reactivate", (_req, res) => {
  // TODO: Submit StakeholderRegistryContract.reactivateStakeholder through Fabric Gateway.
  res.status(501).json({ error: "reactivate stakeholder endpoint is not implemented yet" });
});

stakeholderRouter.get("/:stakeholderId", (_req, res) => {
  // TODO: Evaluate StakeholderRegistryContract.getStakeholder through Fabric Gateway.
  res.status(501).json({ error: "get stakeholder endpoint is not implemented yet" });
});
