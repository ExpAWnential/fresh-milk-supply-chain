import { Router } from "express";
import type { Request as ExpressRequest } from "express";
import type { TemperatureRepository } from "@fresh-milk/storage";
import { config } from "../config.js";
import { bindLedger, requireString } from "../fabric/ledger.js";
import { sendGatewayError, type GatewayConnector } from "../fabric/request.js";
import { describesMissingEvidence } from "../fabric/anchoredEvidence.js";
import { BATCH_CONTRACT } from "./batches.js";
import {
  EvidenceVerificationError,
  type AnchoredEvidenceReader,
  verifyTemperatureEvidence
} from "../services/evidenceVerification.js";

export const TEMPERATURE_CONTRACT = "TemperatureComplianceContract";

export interface TemperatureRouterDependencies {
  readonly connect: GatewayConnector;
  readonly temperatureRepository?: TemperatureRepository;
  // Builds a reader that queries the ledger as whoever made the request, so the contract's own
  // role check applies. Required: a verification that cannot consult the anchor would be
  // comparing the database against itself, which proves nothing.
  readonly readerForRequest: (request: ExpressRequest) => AnchoredEvidenceReader;
}

export function createTemperatureRouter({
  connect,
  temperatureRepository,
  readerForRequest
}: TemperatureRouterDependencies): Router {
  const temperature = bindLedger(connect, config.supplychainChaincodeName, TEMPERATURE_CONTRACT);
  // Reading a batch is how the evidence listing below borrows the contract's own authorisation.
  const batches = bindLedger(connect, config.supplychainChaincodeName, BATCH_CONTRACT);
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
      await temperature.submit(
        req,
        "submitTemperatureEvidence",
        evidenceId,
        req.params.batchId,
        evidenceHash,
        offChainReference,
        JSON.stringify(statistics)
      );
      res.status(201).json({ evidenceId, batchId: req.params.batchId });
    } catch (error) {
      sendGatewayError(res, error);
    }
  });

  router.post("/batches/:batchId/resolve-breach", async (req, res) => {
    try {
      const reason = requireString(req.body?.reason, "reason");
      await temperature.submit(req, "resolveTemperatureBreach", req.params.batchId, reason);
      res.json({ batchId: req.params.batchId, reason });
    } catch (error) {
      sendGatewayError(res, error);
    }
  });

  // The evidence ID embeds a hash of the readings, so it cannot be guessed. Without this a
  // regulator who sees a batch flip to COLD_CHAIN_BREACH has no way to reach the evidence that
  // caused it. The batch is read from the ledger first, so the contract decides who may look.
  router.get("/batches/:batchId/evidence", async (req, res) => {
    if (!temperatureRepository) {
      res.status(503).json({ error: "temperature storage is not configured" });
      return;
    }

    try {
      await batches.evaluateJson(req, "getBatch", req.params.batchId);
      const evidence = await temperatureRepository.listEvidenceForBatch(req.params.batchId);

      res.json(
        evidence.map((record) => ({
          evidenceId: record.evidenceId,
          evidenceHash: record.evidenceHash,
          readingCount: record.readingCount,
          submissionStatus: record.submissionStatus,
          fabricTransactionId: record.fabricTransactionId
        }))
      );
    } catch (error) {
      sendGatewayError(res, error);
    }
  });

  router.get("/evidence/:evidenceId", async (req, res) => {
    try {
      res.json(
        await temperature.evaluateJson(req, "getTemperatureEvidence", req.params.evidenceId)
      );
    } catch (error) {
      // Evidence the ledger has never seen answers 404, so a caller can tell that apart from a
      // refusal by the status alone rather than matching on the contract's wording.
      if (describesMissingEvidence(error)) {
        res.status(404).json({ error: `Evidence '${req.params.evidenceId}' is not on the ledger.` });
        return;
      }
      sendGatewayError(res, error);
    }
  });

  router.get("/evidence/:evidenceId/verify", async (req, res) => {
    if (!temperatureRepository) {
      res.status(503).json({ error: "temperature storage is not configured" });
      return;
    }

    // Resolved before the try below, so a missing or unknown identity header is reported the same
    // way every other route reports it rather than falling through to an opaque 500.
    let anchoredEvidenceReader: AnchoredEvidenceReader;
    try {
      anchoredEvidenceReader = readerForRequest(req);
    } catch (error) {
      sendGatewayError(res, error);
      return;
    }

    try {
      // Verification reads the anchored hash as the caller, so the contract decides whether they
      // are allowed to see it rather than this route trusting an unauthenticated request.
      const result = await verifyTemperatureEvidence(req.params.evidenceId, {
        temperatureRepository,
        anchoredEvidenceReader
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
