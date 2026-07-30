import { Router } from "express";
import { config } from "../config.js";
import { sendGatewayError, withGateway } from "../fabric/request.js";

const CONTRACT = "StakeholderRegistryContract";

export const stakeholderRouter = Router();

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`'${field}' must be a non-empty string.`);
  }
  return value.trim();
}

// Creates the first regulator on an empty registry. Every other registration needs an existing
// regulator to authorise it, so without this the ledger can never be set up. The contract limits
// it to the regulator MSP and to one successful call.
stakeholderRouter.post("/bootstrap", async (req, res) => {
  try {
    const stakeholderId = requireString(req.body?.stakeholderId, "stakeholderId");
    await withGateway(req, (client) =>
      client.submitTransaction(
        config.stakeholderChaincodeName,
        CONTRACT,
        "bootstrapRegulator",
        stakeholderId
      )
    );
    res.status(201).json({ stakeholderId, role: "REGULATOR" });
  } catch (error) {
    sendGatewayError(res, error);
  }
});

stakeholderRouter.post("/", async (req, res) => {
  try {
    const stakeholderId = requireString(req.body?.stakeholderId, "stakeholderId");
    const role = requireString(req.body?.role, "role");
    const certificateId = requireString(req.body?.certificateId, "certificateId");

    await withGateway(req, (client) =>
      client.submitTransaction(
        config.stakeholderChaincodeName,
        CONTRACT,
        "registerStakeholder",
        stakeholderId,
        role,
        certificateId
      )
    );
    res.status(201).json({ stakeholderId, role });
  } catch (error) {
    sendGatewayError(res, error);
  }
});

stakeholderRouter.patch("/:stakeholderId/role", async (req, res) => {
  try {
    const role = requireString(req.body?.role, "role");
    await withGateway(req, (client) =>
      client.submitTransaction(
        config.stakeholderChaincodeName,
        CONTRACT,
        "updateStakeholderRole",
        req.params.stakeholderId,
        role
      )
    );
    res.json({ stakeholderId: req.params.stakeholderId, role });
  } catch (error) {
    sendGatewayError(res, error);
  }
});

stakeholderRouter.post("/:stakeholderId/suspend", async (req, res) => {
  try {
    await withGateway(req, (client) =>
      client.submitTransaction(
        config.stakeholderChaincodeName,
        CONTRACT,
        "suspendStakeholder",
        req.params.stakeholderId
      )
    );
    res.json({ stakeholderId: req.params.stakeholderId, active: false });
  } catch (error) {
    sendGatewayError(res, error);
  }
});

stakeholderRouter.post("/:stakeholderId/reactivate", async (req, res) => {
  try {
    await withGateway(req, (client) =>
      client.submitTransaction(
        config.stakeholderChaincodeName,
        CONTRACT,
        "reactivateStakeholder",
        req.params.stakeholderId
      )
    );
    res.json({ stakeholderId: req.params.stakeholderId, active: true });
  } catch (error) {
    sendGatewayError(res, error);
  }
});

stakeholderRouter.get("/:stakeholderId", async (req, res) => {
  try {
    const bytes = await withGateway(req, (client) =>
      client.evaluateTransaction(
        config.stakeholderChaincodeName,
        CONTRACT,
        "getStakeholder",
        req.params.stakeholderId
      )
    );
    res.json(JSON.parse(Buffer.from(bytes).toString()));
  } catch (error) {
    sendGatewayError(res, error);
  }
});
