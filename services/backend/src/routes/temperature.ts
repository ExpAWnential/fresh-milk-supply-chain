import { Router } from "express";
import type { TemperatureRepository } from "@fresh-milk/storage";
import {
  EvidenceVerificationError,
  type AnchoredEvidenceReader,
  verifyTemperatureEvidence
} from "../services/evidenceVerification.js";

export interface TemperatureRouterDependencies {
  readonly temperatureRepository?: TemperatureRepository;
  readonly anchoredEvidenceReader?: AnchoredEvidenceReader;
}

export function createTemperatureRouter(
  dependencies: TemperatureRouterDependencies = {}
): Router {
  const router = Router();

  router.post("/batches/:batchId/evidence", (_req, res) => {
    // TODO: Submit TemperatureComplianceContract.submitTemperatureEvidence through Fabric Gateway.
    res.status(501).json({ error: "submit temperature evidence endpoint is not implemented yet" });
  });

  router.post("/batches/:batchId/resolve-breach", (_req, res) => {
    // TODO: Submit TemperatureComplianceContract.resolveTemperatureBreach through Fabric Gateway.
    res.status(501).json({ error: "resolve breach endpoint is not implemented yet" });
  });

  router.get("/batches/:batchId/evidence", (_req, res) => {
    // TODO: Return the anchored evidence recorded against this batch.
    res.status(501).json({ error: "batch temperature evidence endpoint is not implemented yet" });
  });

  router.get("/evidence/:evidenceId", (_req, res) => {
    // TODO: Evaluate TemperatureComplianceContract.getTemperatureEvidence through Fabric Gateway.
    res.status(501).json({ error: "get evidence endpoint is not implemented yet" });
  });

  router.get("/evidence/:evidenceId/verify", async (req, res) => {
    if (!dependencies.temperatureRepository) {
      res.status(503).json({ error: "temperature storage is not configured" });
      return;
    }

    try {
      const result = await verifyTemperatureEvidence(req.params.evidenceId, {
        temperatureRepository: dependencies.temperatureRepository,
        anchoredEvidenceReader: dependencies.anchoredEvidenceReader
      });
      res.json(result);
    } catch (error) {
      if (error instanceof EvidenceVerificationError) {
        const status = error.code === "EVIDENCE_NOT_FOUND" ? 404 : 409;
        res.status(status).json({ error: error.message, code: error.code });
        return;
      }

      console.error("Failed to verify temperature evidence.", error);
      res.status(500).json({ error: "failed to verify temperature evidence" });
    }
  });

  return router;
}

export const temperatureRouter = createTemperatureRouter();
