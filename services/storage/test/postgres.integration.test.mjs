import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  createPool,
  createTemperatureRepository,
  createVerdictRepository,
  ORACLE_DATABASE_URL,
  REGULATOR_DATABASE_URL,
  sha256TemperatureReadings
} from "../dist/index.js";

const enabled = process.env.RUN_POSTGRES_INTEGRATION === "1";

const tamperCommand = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "dist",
  "tamperEvidence.js"
);

// Run the tamper command through its real entry point.
function runTamper(evidenceId, ...options) {
  return spawnSync(
    process.execPath,
    [tamperCommand, "--evidence", evidenceId, ...options, "--confirm-tamper"],
    { encoding: "utf8", env: { ...process.env, DATABASE_URL: ORACLE_DATABASE_URL } }
  );
}

test(
  "PostgreSQL persists, anchors and retrieves temperature evidence",
  { skip: !enabled },
  async () => {
    const pool = createPool({
      connectionString: process.env.DATABASE_URL ?? ORACLE_DATABASE_URL
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
      await pool.query("DELETE FROM temperature_evidence WHERE evidence_id = $1", [evidenceId]);

      const evidenceHash = sha256TemperatureReadings(batchId, readings);
      await temperatureRepository.saveEvidence(
        {
          evidenceId,
          batchId,
          sensorId: "SENSOR-INTEGRATION",
          evidenceHash,
          minCelsius: 2.1,
          maxCelsius: 4.7,
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
        sha256TemperatureReadings(batchId, await temperatureRepository.getReadings(evidenceId)),
        evidenceHash
      );

      await temperatureRepository.markAnchored(evidenceId, "fabric-tx-integration");
      assert.deepEqual(await temperatureRepository.getEvidence(evidenceId), {
        evidenceId,
        batchId,
        sensorId: "SENSOR-INTEGRATION",
        evidenceHash,
        minCelsius: 2.1,
        maxCelsius: 4.7,
        readingCount: readings.length,
        complianceOutcome: "COMPLIANT",
        submissionStatus: "ANCHORED",
        fabricTransactionId: "fabric-tx-integration"
      });
    } finally {
      await pool.query("DELETE FROM temperature_evidence WHERE evidence_id = $1", [evidenceId]);
      await pool.end();
    }
  }
);

// Verify database separation against PostgreSQL's real permission system.
test(
  "each company's login is refused by the other company's database",
  { skip: !enabled },
  async () => {
    const crossed = [
      [
        "the oracle's login",
        ORACLE_DATABASE_URL.replace("freshmilk_oracle", "freshmilk_regulator")
      ],
      [
        "the regulator's login",
        REGULATOR_DATABASE_URL.replace("freshmilk_regulator", "freshmilk_oracle")
      ]
    ];

    for (const [who, connectionString] of crossed) {
      const pool = createPool({ connectionString });
      await assert.rejects(pool.query("SELECT 1"), /permission denied|not permitted/i, who);
      await pool.end();
    }
  }
);

test(
  "PostgreSQL archives the ledger's verdicts and replaying an event changes nothing",
  { skip: !enabled },
  async () => {
    const pool = createPool({ connectionString: REGULATOR_DATABASE_URL });
    const verdicts = createVerdictRepository(pool);

    const batchId = "INTEGRATION-VERDICT-BATCH";
    const verdict = {
      evidenceId: "INTEGRATION-VERDICT-EV-1",
      batchId,
      evidenceHash: "b".repeat(64),
      complianceOutcome: "UNSAFE",
      submittedByStakeholderId: "oracle-001",
      fabricTransactionId: "tx-integration-1",
      ledgerTimestamp: "2026-07-30T02:00:00.000Z",
      eventName: "ColdChainBreach"
    };
    const earlier = {
      ...verdict,
      evidenceId: "INTEGRATION-VERDICT-EV-0",
      evidenceHash: "c".repeat(64),
      complianceOutcome: "COMPLIANT",
      fabricTransactionId: "tx-integration-0",
      ledgerTimestamp: "2026-07-30T01:00:00.000Z",
      eventName: "TemperatureEvidenceSubmitted"
    };

    // Fixed IDs and idempotent writes keep this repeatable without DELETE permission.
    try {
      await verdicts.recordVerdict(verdict);
      await verdicts.recordVerdict(earlier);

      assert.deepEqual(
        (await verdicts.listVerdictsForBatch(batchId)).map((entry) => entry.evidenceId),
        ["INTEGRATION-VERDICT-EV-0", "INTEGRATION-VERDICT-EV-1"]
      );

      // Replayed events update the existing row without error.
      await verdicts.recordVerdict(verdict);
      const afterReplay = await verdicts.listVerdictsForBatch(batchId);
      assert.equal(afterReplay.length, 2);
      assert.deepEqual(afterReplay[1], verdict);

      // TIMESTAMPTZ preserves the contract timestamp.
      assert.equal(afterReplay[1].ledgerTimestamp, "2026-07-30T02:00:00.000Z");
    } finally {
      await pool.end();
    }
  }
);

// PostgreSQL permissions prevent the regulator application from deleting its archive.
test(
  "the regulator can add to its archive but cannot delete from it",
  { skip: !enabled },
  async () => {
    const pool = createPool({ connectionString: REGULATOR_DATABASE_URL });

    try {
      await assert.rejects(
        pool.query("DELETE FROM ledger_compliance_verdicts WHERE batch_id = $1", ["anything"]),
        /permission denied/i
      );
    } finally {
      await pool.end();
    }
  }
);

// Schema constraints reject verdicts the contract cannot produce.
test(
  "the archive refuses a verdict the ledger could not have produced",
  { skip: !enabled },
  async () => {
    const pool = createPool({ connectionString: REGULATOR_DATABASE_URL });
    const verdicts = createVerdictRepository(pool);
    const batchId = "INTEGRATION-CONSTRAINT-BATCH";

    const rejected = [
      ["a hash that is not a SHA-256 digest", { evidenceHash: "not-a-hash" }],
      ["a hash in upper case, which would never compare equal", { evidenceHash: "B".repeat(64) }],
      ["an outcome the contract never reaches", { complianceOutcome: "PROBABLY_FINE" }],
      ["an event the listener does not subscribe to", { eventName: "StakeholderSuspended" }]
    ];

    try {
      for (const [description, overrides] of rejected) {
        await assert.rejects(
          verdicts.recordVerdict({
            evidenceId: "INTEGRATION-CONSTRAINT-EV",
            batchId,
            evidenceHash: "d".repeat(64),
            complianceOutcome: "COMPLIANT",
            submittedByStakeholderId: "oracle-001",
            fabricTransactionId: "tx-integration-constraint",
            ledgerTimestamp: "2026-07-30T03:00:00.000Z",
            eventName: "TemperatureEvidenceSubmitted",
            ...overrides
          }),
          description
        );
      }
      // Rejected inserts leave no rows to clean up.
      assert.deepEqual(await verdicts.listVerdictsForBatch(batchId), []);
    } finally {
      await pool.end();
    }
  }
);

// Repeating an oracle run must not replace readings already covered by Fabric's hash.
test(
  "re-running against anchored evidence leaves its readings untouched",
  { skip: !enabled },
  async () => {
    const pool = createPool({ connectionString: ORACLE_DATABASE_URL });
    const temperature = createTemperatureRepository(pool);

    const evidenceId = "INTEGRATION-ANCHORED-EVIDENCE";
    const batchId = "INTEGRATION-ANCHORED-BATCH";
    const readings = [
      { sensorId: "S-1", recordedAt: "2026-07-20T09:00:00.000Z", celsius: 2.1 },
      { sensorId: "S-1", recordedAt: "2026-07-20T09:05:00.000Z", celsius: 3.2 }
    ];
    const evidence = {
      evidenceId,
      batchId,
      sensorId: "S-1",
      evidenceHash: sha256TemperatureReadings(batchId, readings),
      minCelsius: 2.1,
      maxCelsius: 3.2,
      readingCount: readings.length,
      complianceOutcome: "COMPLIANT",
      submissionStatus: "PENDING",
      fabricTransactionId: null
    };

    try {
      await pool.query("DELETE FROM temperature_evidence WHERE evidence_id = $1", [evidenceId]);

      await temperature.saveEvidence(evidence, readings);
      await temperature.markAnchored(evidenceId, "tx-integration-anchored");

      // Simulate a retry carrying different readings.
      const rewritten = [
        { sensorId: "S-1", recordedAt: "2026-07-20T09:00:00.000Z", celsius: 99 },
        { sensorId: "S-1", recordedAt: "2026-07-20T09:05:00.000Z", celsius: 98 }
      ];
      await temperature.saveEvidence(
        {
          ...evidence,
          evidenceHash: sha256TemperatureReadings(batchId, rewritten),
          minCelsius: 98,
          maxCelsius: 99
        },
        rewritten
      );

      const stored = await temperature.getReadings(evidenceId);
      assert.equal(stored.length, 2, "the anchored readings were replaced");
      assert.equal(
        sha256TemperatureReadings(batchId, stored),
        evidence.evidenceHash,
        "the anchored readings no longer hash to what the ledger covers"
      );
      // Preserve the committed anchoring metadata too.
      const after = await temperature.getEvidence(evidenceId);
      assert.equal(after.submissionStatus, "ANCHORED");
      assert.equal(after.fabricTransactionId, "tx-integration-anchored");
    } finally {
      await pool.query("DELETE FROM temperature_evidence WHERE evidence_id = $1", [evidenceId]);
      await pool.end();
    }
  }
);

// Exercise the tamper command's real update statement against PostgreSQL.
test(
  "the tamper command alters a stored reading and breaks the fingerprint",
  { skip: !enabled },
  async () => {
    const pool = createPool({ connectionString: ORACLE_DATABASE_URL });
    const temperature = createTemperatureRepository(pool);

    const evidenceId = "INTEGRATION-TAMPER-EVIDENCE";
    const batchId = "INTEGRATION-TAMPER-BATCH";
    const readings = [
      { sensorId: "S-1", recordedAt: "2026-07-20T09:00:00.000Z", celsius: 2 },
      { sensorId: "S-1", recordedAt: "2026-07-20T09:05:00.000Z", celsius: 3 }
    ];
    const anchoredHash = sha256TemperatureReadings(batchId, readings);

    try {
      await pool.query("DELETE FROM temperature_evidence WHERE evidence_id = $1", [evidenceId]);
      await temperature.saveEvidence(
        {
          evidenceId,
          batchId,
          sensorId: "S-1",
          evidenceHash: anchoredHash,
          minCelsius: 2,
          maxCelsius: 3,
          readingCount: readings.length,
          complianceOutcome: "COMPLIANT",
          submissionStatus: "PENDING",
          fabricTransactionId: null
        },
        readings
      );
      await temperature.markAnchored(evidenceId, "tx-integration-tamper");

      const run = runTamper(evidenceId, "--delta", "1.5");

      assert.equal(run.status, 0, run.stderr);
      const report = JSON.parse(run.stdout);
      assert.equal(report.before.result, "MATCH");
      assert.equal(report.after.result, "HASH_MISMATCH");
      // The simulated ledger anchor remains unchanged.
      assert.equal(report.anchoredHash, anchoredHash);

      // Confirm that the database row, not only the report, changed.
      const stored = await temperature.getReadings(evidenceId);
      assert.equal(stored[0].celsius, 3.5);
      assert.notEqual(sha256TemperatureReadings(batchId, stored), anchoredHash);

      // A second tamper attempt is refused because the baseline is already invalid.
      const again = runTamper(evidenceId);
      assert.equal(again.status, 1);
      assert.match(again.stderr, /already fails verification/);
    } finally {
      await pool.query("DELETE FROM temperature_evidence WHERE evidence_id = $1", [evidenceId]);
      await pool.end();
    }
  }
);
