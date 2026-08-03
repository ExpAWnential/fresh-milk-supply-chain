/**
 * Exposes the temperature evidence workflow through the backend API.
 *
 * These routes connect the oracle's off-chain readings with the on-chain evidence anchor. They also
 * enforce ledger-backed read access, provide independent verification, and let the regulator resolve
 * a breach without allowing the HTTP caller to choose the contract's compliance verdict.
 */
import { Router } from "express";
import type { TemperatureRepository } from "@fresh-milk/storage";
import { config } from "../config.js";
import { BATCH_CONTRACT, TEMPERATURE_CONTRACT } from "../fabric/contracts.js";
import { bindLedger, requireString } from "../fabric/ledger.js";
import { sendGatewayError, type GatewayConnector } from "../fabric/connection.js";
import { describesMissingEvidence } from "../fabric/anchoredEvidence.js";
import { ReadingsUnavailableError } from "../services/readingsSource.js";
import {
  EvidenceVerificationError,
  type AnchoredEvidenceReader,
  type SensorKeyReader,
  type ReadingsSource,
  verifyTemperatureEvidence
} from "../services/evidenceVerification.js";

export interface TemperatureRouterDependencies {
  readonly connect: GatewayConnector;
  // Present only for the oracle, which stores and publishes the raw readings.
  readonly temperatureRepository?: TemperatureRepository;
  // Reads the trusted comparison values from Fabric as this organisation.
  readonly anchoredEvidenceReader: AnchoredEvidenceReader;
  readonly sensorKeyReader: SensorKeyReader;
  // Reads locally for the oracle and remotely for every other organisation.
  readonly readingsSource: ReadingsSource;
}

export function createTemperatureRouter({
  connect,
  temperatureRepository,
  anchoredEvidenceReader,
  sensorKeyReader,
  readingsSource
}: TemperatureRouterDependencies): Router {
  const temperature = bindLedger(connect, config.supplychainChaincodeName, TEMPERATURE_CONTRACT);
  // The evidence listing uses the batch contract's existing read authorisation.
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

      // The contract derives compliance. The caller cannot submit its own verdict.
      await temperature.submit(
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
      await temperature.submit("resolveTemperatureBreach", req.params.batchId, reason);
      res.json({ batchId: req.params.batchId, reason });
    } catch (error) {
      sendGatewayError(res, error);
    }
  });

  // List off-chain evidence only after Fabric authorises this organisation to read the batch.
  router.get("/batches/:batchId/evidence", async (req, res) => {
    if (!temperatureRepository) {
      res.status(503).json({ error: "temperature storage is not configured" });
      return;
    }

    try {
      await batches.evaluateJson("getBatch", req.params.batchId);
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
        await temperature.evaluateJson("getTemperatureEvidence", req.params.evidenceId)
      );
    } catch (error) {
      if (describesMissingEvidence(error)) {
        res.status(404).json({ error: `Evidence '${req.params.evidenceId}' is not on the ledger.` });
        return;
      }
      sendGatewayError(res, error);
    }
  });

  // Publishes the raw readings used by other organisations. The preceding ledger read authorises
  // this backend's identity, not the HTTP caller. See docs/design.md for that proof-of-concept limit.
  router.get("/evidence/:evidenceId/readings", async (req, res) => {
    if (!temperatureRepository) {
      res.status(503).json({ error: "temperature storage is not configured" });
      return;
    }

    try {
      await temperature.evaluateJson("getTemperatureEvidence", req.params.evidenceId);
      res.json(await temperatureRepository.getReadings(req.params.evidenceId));
    } catch (error) {
      if (describesMissingEvidence(error)) {
        res.status(404).json({ error: `Evidence '${req.params.evidenceId}' is not on the ledger.` });
        return;
      }
      sendGatewayError(res, error);
    }
  });

  // Every organisation can verify, including those without their own readings database.
  router.get("/evidence/:evidenceId/verify", async (req, res) => {
    try {
      // Compare holder-supplied readings with values this organisation reads from Fabric.
      const result = await verifyTemperatureEvidence(req.params.evidenceId, {
        readingsSource,
        anchoredEvidenceReader,
        sensorKeyReader
      });
      res.json(result);
    } catch (error) {
      if (error instanceof EvidenceVerificationError) {
        const status = error.code === "EVIDENCE_NOT_FOUND" ? 404 : 409;
        res.status(status).json({ error: error.message, code: error.code });
        return;
      }

      // Report failure by the remote readings holder separately from a local verification fault.
      if (error instanceof ReadingsUnavailableError) {
        res.status(502).json({ error: error.message, code: "READINGS_UNAVAILABLE" });
        return;
      }

      console.error("Failed to verify temperature evidence.", error);
      res.status(500).json({ error: "failed to verify temperature evidence" });
    }
  });

  return router;
}
