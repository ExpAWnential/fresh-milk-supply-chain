/**
 * HTTP for temperature evidence: submitting it, clearing a breach, reading a record back, and
 * verifying the stored readings against what the ledger anchored.
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
  type ReadingsSource,
  verifyTemperatureEvidence
} from "../services/evidenceVerification.js";

export interface TemperatureRouterDependencies {
  readonly connect: GatewayConnector;
  // Only the oracle holds one. It is what serves the readings the other five fetch.
  readonly temperatureRepository?: TemperatureRepository;
  // Reads the anchored hash off the ledger as this company. Required: a verification that cannot
  // consult the anchor would be comparing the readings against themselves, which proves nothing.
  readonly anchoredEvidenceReader: AnchoredEvidenceReader;
  // Where this company gets the readings. Every company can verify, database or not.
  readonly readingsSource: ReadingsSource;
}

export function createTemperatureRouter({
  connect,
  temperatureRepository,
  anchoredEvidenceReader,
  readingsSource
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

  // The evidence ID embeds a hash of the readings, so it cannot be guessed. Without this a
  // regulator who sees a batch flip to COLD_CHAIN_BREACH has no way to reach the evidence that
  // caused it. The batch is read from the ledger first, which establishes that the batch exists
  // and that this company may see it. As with the readings route below, that check is about this
  // company rather than about whoever sent the request.
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
      // Evidence the ledger has never seen answers 404, so a caller can tell that apart from a
      // refusal by the status alone rather than matching on the contract's wording.
      if (describesMissingEvidence(error)) {
        res.status(404).json({ error: `Evidence '${req.params.evidenceId}' is not on the ledger.` });
        return;
      }
      sendGatewayError(res, error);
    }
  });

  // The readings the fingerprint covers. This is what the other five companies fetch to run their
  // own verification, so it is the one endpoint here that exists for somebody else.
  //
  // Be clear about what the ledger read in front of it does and does not do. It is signed with
  // this company's certificate, because that is the only one this process holds, so it establishes
  // that the evidence exists and that this company may see it. It says nothing about the caller:
  // anyone who can reach this port and knows an evidence ID gets the readings. The ID embeds part
  // of the hash so it is not enumerable, but that is obscurity, not access control.
  //
  // The verification is sound regardless, because the checker compares against an anchor it read
  // off the ledger itself. Serving nothing, or serving rubbish, shows up as a mismatch or an
  // error, never as a clean result. docs/design.md sets out what a real fix would take.
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

  // Available on every company's backend, including the four that keep no database of their own.
  // A retailer checking its supplier's records is the case this exists for, and it would be a
  // strange check if only the company being checked could run it.
  router.get("/evidence/:evidenceId/verify", async (req, res) => {
    try {
      // The anchor is read with this company's own certificate and the readings come from whoever
      // holds them, so the comparison is between two records no single party controls.
      const result = await verifyTemperatureEvidence(req.params.evidenceId, {
        readingsSource,
        anchoredEvidenceReader
      });
      res.json(result);
    } catch (error) {
      if (error instanceof EvidenceVerificationError) {
        const status = error.code === "EVIDENCE_NOT_FOUND" ? 404 : 409;
        res.status(status).json({ error: error.message, code: error.code });
        return;
      }

      // The company being checked would not hand its readings over. That is not a fault in this
      // backend, and reporting it as one would blame the checker for the holder going quiet, which
      // is the single most misleading thing this endpoint could say.
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
