/**
 * HTTP for the stakeholder registry. Validates request fields and forwards each one to the
 * contract, which is where every authorisation decision is actually made.
 */
import { Router } from "express";
import { config } from "../config.js";
import { STAKEHOLDER_CONTRACT } from "../fabric/contracts.js";
import { bindLedger, requireString } from "../fabric/ledger.js";
import { sendGatewayError, type GatewayConnector } from "../fabric/request.js";

export function createStakeholderRouter(connect: GatewayConnector): Router {
  const registry = bindLedger(connect, config.stakeholderChaincodeName, STAKEHOLDER_CONTRACT);
  const router = Router();

  // Creates the first regulator on an empty registry. Every other registration needs an existing
  // regulator to authorise it, so without this the ledger can never be set up. The contract limits
  // it to the regulator MSP and to one successful call.
  router.post("/bootstrap", async (req, res) => {
    try {
      const stakeholderId = requireString(req.body?.stakeholderId, "stakeholderId");
      await registry.submit(req, "bootstrapRegulator", stakeholderId);
      res.status(201).json({ stakeholderId, role: "REGULATOR" });
    } catch (error) {
      sendGatewayError(res, error);
    }
  });

  router.post("/", async (req, res) => {
    try {
      const stakeholderId = requireString(req.body?.stakeholderId, "stakeholderId");
      const role = requireString(req.body?.role, "role");
      const certificateId = requireString(req.body?.certificateId, "certificateId");

      await registry.submit(req, "registerStakeholder", stakeholderId, role, certificateId);
      res.status(201).json({ stakeholderId, role });
    } catch (error) {
      sendGatewayError(res, error);
    }
  });

  router.patch("/:stakeholderId/role", async (req, res) => {
    try {
      const role = requireString(req.body?.role, "role");
      await registry.submit(req, "updateStakeholderRole", req.params.stakeholderId, role);
      res.json({ stakeholderId: req.params.stakeholderId, role });
    } catch (error) {
      sendGatewayError(res, error);
    }
  });

  router.post("/:stakeholderId/suspend", async (req, res) => {
    try {
      await registry.submit(req, "suspendStakeholder", req.params.stakeholderId);
      res.json({ stakeholderId: req.params.stakeholderId, active: false });
    } catch (error) {
      sendGatewayError(res, error);
    }
  });

  router.post("/:stakeholderId/reactivate", async (req, res) => {
    try {
      await registry.submit(req, "reactivateStakeholder", req.params.stakeholderId);
      res.json({ stakeholderId: req.params.stakeholderId, active: true });
    } catch (error) {
      sendGatewayError(res, error);
    }
  });

  router.get("/:stakeholderId", async (req, res) => {
    try {
      res.json(await registry.evaluateJson(req, "getStakeholder", req.params.stakeholderId));
    } catch (error) {
      sendGatewayError(res, error);
    }
  });

  return router;
}
