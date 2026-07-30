import { Router } from "express";
import type { Request as ExpressRequest } from "express";
import type { TemperatureRepository } from "@fresh-milk/storage";
import { config } from "../config.js";
import { sendGatewayError, withGateway } from "../fabric/request.js";
import {
  EvidenceVerificationError,
  type AnchoredEvidenceReader,
  verifyTemperatureEvidence
} from "../services/evidenceVerification.js";

const CONTRACT = "TemperatureComplianceContract";

export interface TemperatureRouterDependencies {
  readonly temperatureRepository?: TemperatureRepository;
  readonly anchoredEvidenceReader?: AnchoredEvidenceReader;
  // Builds a reader that queries the ledger as whoever made the request, so the contract's own
  // role check applies. Tests supply a fixed reader instead.
  readonly readerForRequest?: (request: ExpressRequest) => AnchoredEvidenceReader;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`'${field}' must be a non-empty string.`);
  }
  return value.trim();
}

export function createTemperatureRouter(
  dependencies: TemperatureRouterDependencies = {}
): Router {
  const router = Router();

  router.post("/batches/:batchId/evidence", async (req, res) => {
    try {
      const evidenceId = requireString(req.body?.evidenceId, "evidenceId");
      const evidenceHash = requireString(req.body?.evidenceHash, "evidenceHash");
      const offChainReference = requireString(req.body?.offChainReference, "offChainReference");
      const statistics = req.body?.statistics;
      if (typeof statistics !== "object" || statistics === null) {
        throw new Error("'statistics' must be an object.");
      }

      // The compliance outcome is deliberately not accepted from the caller. The contract
      // derives it from these statistics itself.
      await withGateway(req, (client) =>
        client.submitTransaction(
          config.supplychainChaincodeName,
          CONTRACT,
          "submitTemperatureEvidence",
          evidenceId,
          req.params.batchId,
          evidenceHash,
          offChainReference,
          JSON.stringify(statistics)
        )
      );
      res.status(201).json({ evidenceId, batchId: req.params.batchId });
    } catch (error) {
      sendGatewayError(res, error);
    }
  });

  router.post("/batches/:batchId/resolve-breach", async (req, res) => {
    try {
      const reason = requireString(req.body?.reason, "reason");
      await withGateway(req, (client) =>
        client.submitTransaction(
          config.supplychainChaincodeName,
          CONTRACT,
          "resolveTemperatureBreach",
          req.params.batchId,
          reason
        )
      );
      res.json({ batchId: req.params.batchId, reason });
    } catch (error) {
      sendGatewayError(res, error);
    }
  });

  router.get("/evidence/:evidenceId", async (req, res) => {
    try {
      const bytes = await withGateway(req, (client) =>
        client.evaluateTransaction(
          config.supplychainChaincodeName,
          CONTRACT,
          "getTemperatureEvidence",
          req.params.evidenceId
        )
      );
      res.json(JSON.parse(Buffer.from(bytes).toString()));
    } catch (error) {
      sendGatewayError(res, error);
    }
  });

  router.get("/evidence/:evidenceId/verify", async (req, res) => {
    if (!dependencies.temperatureRepository) {
      res.status(503).json({ error: "temperature storage is not configured" });
      return;
    }

    try {
      // Verification reads the anchored hash as the caller, so the contract decides whether they
      // are allowed to see it rather than this route trusting an unauthenticated request.
      const result = await verifyTemperatureEvidence(req.params.evidenceId, {
        temperatureRepository: dependencies.temperatureRepository,
        anchoredEvidenceReader: dependencies.readerForRequest?.(req) ?? dependencies.anchoredEvidenceReader
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
