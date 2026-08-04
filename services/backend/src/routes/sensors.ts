/**
 * Exposes the regulator-managed sensor key registry.
 * Public keys are readable for independent verification, while registration and revocation remain
 * protected by the contract's regulator role check.
 */
import { Router } from "express";
import { config } from "../config.js";
import { STAKEHOLDER_CONTRACT } from "../fabric/contracts.js";
import { bindLedger, requireString } from "../fabric/ledger.js";
import { sendGatewayError, type GatewayConnector } from "../fabric/connection.js";
import { describesMissingSensorKey } from "../fabric/sensorKeys.js";

export function createSensorRouter(connect: GatewayConnector): Router {
  const registry = bindLedger(connect, config.stakeholderChaincodeName, STAKEHOLDER_CONTRACT);
  const router = Router();

  router.post("/", async (req, res) => {
    try {
      const sensorId = requireString(req.body?.sensorId, "sensorId");
      const publicKey = requireString(req.body?.publicKey, "publicKey");
      // Named rather than defaulted, so a future second scheme cannot be registered as the first
      // one by a caller that simply left the field out.
      const algorithm = requireString(req.body?.algorithm, "algorithm");

      await registry.submit("registerSensorKey", sensorId, publicKey, algorithm);
      res.status(201).json({ sensorId, algorithm });
    } catch (error) {
      sendGatewayError(res, error);
    }
  });

  router.post("/:sensorId/revoke", async (req, res) => {
    try {
      await registry.submit("revokeSensorKey", req.params.sensorId);
      res.json({ sensorId: req.params.sensorId, active: false });
    } catch (error) {
      sendGatewayError(res, error);
    }
  });

  router.post("/:sensorId/reactivate", async (req, res) => {
    try {
      await registry.submit("reactivateSensorKey", req.params.sensorId);
      res.json({ sensorId: req.params.sensorId, active: true });
    } catch (error) {
      sendGatewayError(res, error);
    }
  });

  router.get("/:sensorId", async (req, res) => {
    try {
      res.json(await registry.evaluateJson("getSensorKey", req.params.sensorId));
    } catch (error) {
      if (describesMissingSensorKey(error)) {
        res.status(404).json({ error: `Sensor '${req.params.sensorId}' has no registered key.` });
        return;
      }
      sendGatewayError(res, error);
    }
  });

  return router;
}
