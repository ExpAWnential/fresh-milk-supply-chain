import { Router } from "express";

// Consumers are not members of the Fabric network. They read a filtered view of a batch
// through this endpoint instead of holding a blockchain identity.
export const publicRouter = Router();

publicRouter.get("/batches/:batchId", (_req, res) => {
  // TODO: Return the consumer-facing batch view: origin, lifecycle milestones and cold-chain status.
  // TODO: Exclude stakeholder identities, raw readings and other non-public data.
  res.status(501).json({ error: "public batch endpoint is not implemented yet" });
});
