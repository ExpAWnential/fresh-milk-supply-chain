import assert from "node:assert/strict";
import test from "node:test";
import {
  createDocumentRepository,
  createPool,
  createTemperatureRepository,
  sha256TemperatureReadings
} from "../dist/index.js";

const enabled = process.env.RUN_POSTGRES_INTEGRATION === "1";

test(
  "PostgreSQL persists, anchors and retrieves evidence and documents",
  { skip: !enabled },
  async () => {
    const pool = createPool({
      connectionString:
        process.env.DATABASE_URL ??
        "postgres://freshmilk:freshmilk@localhost:5432/freshmilk"
    });
    const temperatureRepository = createTemperatureRepository(pool);
    const documentRepository = createDocumentRepository(pool);

    const evidenceId = "CODEX-RAY-INTEGRATION-EVIDENCE";
    const batchId = "CODEX-RAY-INTEGRATION-BATCH";
    const documentId = "CODEX-RAY-INTEGRATION-DOCUMENT";
    const readings = [
      {
        sensorId: "SENSOR-INTEGRATION",
        recordedAt: "2026-07-20T09:00:00Z",
        celsius: 2.1
      },
      {
        sensorId: "SENSOR-INTEGRATION",
        recordedAt: "2026-07-20T09:05:00Z",
        celsius: 4.7
      }
    ];

    try {
      await pool.query("DELETE FROM documents WHERE document_id = $1", [documentId]);
      await pool.query("DELETE FROM temperature_evidence WHERE evidence_id = $1", [
        evidenceId
      ]);

      const evidenceHash = sha256TemperatureReadings(batchId, readings);
      await temperatureRepository.saveEvidence(
        {
          evidenceId,
          batchId,
          sensorId: "SENSOR-INTEGRATION",
          evidenceHash,
          minCelsius: 2.1,
          maxCelsius: 4.7,
          averageCelsius: 3.4,
          readingCount: readings.length,
          complianceOutcome: "COMPLIANT",
          submissionStatus: "PENDING",
          fabricTransactionId: null
        },
        readings
      );

      assert.equal(
        (await temperatureRepository.getEvidence(evidenceId))?.submissionStatus,
        "PENDING"
      );
      assert.equal(
        sha256TemperatureReadings(
          batchId,
          await temperatureRepository.getReadings(evidenceId)
        ),
        evidenceHash
      );

      await temperatureRepository.markAnchored(evidenceId, "fabric-tx-integration");
      assert.deepEqual(
        await temperatureRepository.getEvidence(evidenceId),
        {
          evidenceId,
          batchId,
          sensorId: "SENSOR-INTEGRATION",
          evidenceHash,
          minCelsius: 2.1,
          maxCelsius: 4.7,
          averageCelsius: 3.4,
          readingCount: readings.length,
          complianceOutcome: "COMPLIANT",
          submissionStatus: "ANCHORED",
          fabricTransactionId: "fabric-tx-integration"
        }
      );

      const documentHash = "b".repeat(64);
      await documentRepository.saveDocument({
        documentId,
        batchId,
        documentType: "QUALITY_CERTIFICATE",
        fileLocation: "documents/integration.pdf",
        documentHash
      });
      assert.deepEqual(await documentRepository.getDocumentsForBatch(batchId), [
        {
          documentId,
          batchId,
          documentType: "QUALITY_CERTIFICATE",
          fileLocation: "documents/integration.pdf",
          documentHash
        }
      ]);
    } finally {
      await pool.query("DELETE FROM documents WHERE document_id = $1", [documentId]);
      await pool.query("DELETE FROM temperature_evidence WHERE evidence_id = $1", [
        evidenceId
      ]);
      await pool.end();
    }
  }
);
