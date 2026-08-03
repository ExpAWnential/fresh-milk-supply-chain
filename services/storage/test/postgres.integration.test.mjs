import assert from "node:assert/strict";
import test from "node:test";
import {
  createPool,
  createTemperatureRepository,
  ORACLE_DATABASE_URL,
  sha256TemperatureReadings
} from "../dist/index.js";

const enabled = process.env.RUN_POSTGRES_INTEGRATION === "1";

test(
  "PostgreSQL persists, anchors and retrieves temperature evidence",
  { skip: !enabled },
  async () => {
    const pool = createPool({
      connectionString:
        process.env.DATABASE_URL ??
        ORACLE_DATABASE_URL
    });
    const temperatureRepository = createTemperatureRepository(pool);

    const evidenceId = "CODEX-RAY-INTEGRATION-EVIDENCE";
    const batchId = "CODEX-RAY-INTEGRATION-BATCH";
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

    } finally {
      await pool.query("DELETE FROM temperature_evidence WHERE evidence_id = $1", [
        evidenceId
      ]);
      await pool.end();
    }
  }
);
