import { Pool, PoolClient, QueryResult } from "pg";

export type ComplianceOutcome = "COMPLIANT" | "UNSAFE";
export type SubmissionStatus = "PENDING" | "ANCHORED" | "FAILED";

export interface StoredTemperatureReading {
  readonly sensorId: string;
  readonly recordedAt: string;
  readonly celsius: number;
}

export interface StoredTemperatureEvidence {
  readonly evidenceId: string;
  readonly batchId: string;
  readonly sensorId: string;
  readonly evidenceHash: string;
  readonly minCelsius: number;
  readonly maxCelsius: number;
  readonly averageCelsius: number;
  readonly readingCount: number;
  readonly complianceOutcome: ComplianceOutcome;
  readonly submissionStatus: SubmissionStatus;
  readonly fabricTransactionId: string | null;
}

export interface TemperatureRepository {
  saveEvidence(
    evidence: StoredTemperatureEvidence,
    readings: readonly StoredTemperatureReading[]
  ): Promise<void>;
  markAnchored(evidenceId: string, fabricTransactionId: string): Promise<void>;
  markFailed(evidenceId: string): Promise<void>;
  getEvidence(evidenceId: string): Promise<StoredTemperatureEvidence | undefined>;
  getReadings(evidenceId: string): Promise<readonly StoredTemperatureReading[]>;
}

interface EvidenceRow {
  readonly evidence_id: string;
  readonly batch_id: string;
  readonly sensor_id: string;
  readonly evidence_hash: string;
  readonly min_celsius: string | number;
  readonly max_celsius: string | number;
  readonly average_celsius: string | number;
  readonly reading_count: number;
  readonly compliance_outcome: ComplianceOutcome;
  readonly submission_status: SubmissionStatus;
  readonly fabric_transaction_id: string | null;
}

interface ReadingRow {
  readonly sensor_id: string;
  readonly recorded_at: Date | string;
  readonly celsius: string | number;
}

export function createTemperatureRepository(pool: Pool): TemperatureRepository {
  return {
    async saveEvidence(
      evidence: StoredTemperatureEvidence,
      readings: readonly StoredTemperatureReading[]
    ): Promise<void> {
      validateEvidenceForReadings(evidence, readings);

      const client = await pool.connect();

      try {
        await client.query("BEGIN");
        const written = await upsertEvidence(client, evidence);
        // An anchored row is left exactly as it stands. Its readings are what the hash on the
        // ledger covers, so rewriting them would destroy the baseline tamper detection compares
        // against. Any other row is replaced, which is what makes a failed run repeatable.
        if (written) {
          await client.query("DELETE FROM temperature_readings WHERE evidence_id = $1", [
            evidence.evidenceId
          ]);
          await insertReadings(client, evidence.evidenceId, readings);
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async markAnchored(evidenceId: string, fabricTransactionId: string): Promise<void> {
      await pool.query(
        `
          UPDATE temperature_evidence
          SET submission_status = 'ANCHORED',
              fabric_transaction_id = $2
          WHERE evidence_id = $1
        `,
        [evidenceId, fabricTransactionId]
      );
    },

    async markFailed(evidenceId: string): Promise<void> {
      await pool.query(
        `
          UPDATE temperature_evidence
          SET submission_status = 'FAILED'
          WHERE evidence_id = $1
        `,
        [evidenceId]
      );
    },

    async getEvidence(evidenceId: string): Promise<StoredTemperatureEvidence | undefined> {
      const result = await pool.query<EvidenceRow>(
        `
          SELECT evidence_id,
                 batch_id,
                 sensor_id,
                 evidence_hash,
                 min_celsius,
                 max_celsius,
                 average_celsius,
                 reading_count,
                 compliance_outcome,
                 submission_status,
                 fabric_transaction_id
          FROM temperature_evidence
          WHERE evidence_id = $1
        `,
        [evidenceId]
      );

      return result.rows[0] ? mapEvidenceRow(result.rows[0]) : undefined;
    },

    async getReadings(evidenceId: string): Promise<readonly StoredTemperatureReading[]> {
      const result = await pool.query<ReadingRow>(
        `
          SELECT sensor_id,
                 recorded_at,
                 celsius
          FROM temperature_readings
          WHERE evidence_id = $1
          ORDER BY recorded_at ASC, sensor_id ASC, reading_id ASC
        `,
        [evidenceId]
      );

      return result.rows.map(mapReadingRow);
    }
  };
}

function validateEvidenceForReadings(
  evidence: StoredTemperatureEvidence,
  readings: readonly StoredTemperatureReading[]
): void {
  if (readings.length === 0) {
    throw new Error("Cannot save temperature evidence without readings.");
  }

  if (evidence.readingCount !== readings.length) {
    throw new Error(
      `Evidence readingCount ${evidence.readingCount} does not match ${readings.length} readings.`
    );
  }
}

// Reports whether the row was written. The evidence ID is derived from the readings, so a run that
// failed part way through produces the same ID when it is repeated: without the upsert the retry
// would die on the primary key and those readings could never be anchored.
async function upsertEvidence(
  client: PoolClient,
  evidence: StoredTemperatureEvidence
): Promise<boolean> {
  const result: QueryResult = await client.query(
    `
      INSERT INTO temperature_evidence (
        evidence_id,
        batch_id,
        sensor_id,
        evidence_hash,
        min_celsius,
        max_celsius,
        average_celsius,
        reading_count,
        compliance_outcome,
        submission_status,
        fabric_transaction_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (evidence_id) DO UPDATE SET
        batch_id = EXCLUDED.batch_id,
        sensor_id = EXCLUDED.sensor_id,
        evidence_hash = EXCLUDED.evidence_hash,
        min_celsius = EXCLUDED.min_celsius,
        max_celsius = EXCLUDED.max_celsius,
        average_celsius = EXCLUDED.average_celsius,
        reading_count = EXCLUDED.reading_count,
        compliance_outcome = EXCLUDED.compliance_outcome,
        submission_status = EXCLUDED.submission_status,
        fabric_transaction_id = EXCLUDED.fabric_transaction_id
      WHERE temperature_evidence.submission_status <> 'ANCHORED'
    `,
    [
      evidence.evidenceId,
      evidence.batchId,
      evidence.sensorId,
      evidence.evidenceHash,
      evidence.minCelsius,
      evidence.maxCelsius,
      evidence.averageCelsius,
      evidence.readingCount,
      evidence.complianceOutcome,
      evidence.submissionStatus,
      evidence.fabricTransactionId
    ]
  );

  return (result.rowCount ?? 0) > 0;
}

async function insertReadings(
  client: PoolClient,
  evidenceId: string,
  readings: readonly StoredTemperatureReading[]
): Promise<void> {
  for (const reading of readings) {
    await client.query(
      `
        INSERT INTO temperature_readings (
          evidence_id,
          sensor_id,
          recorded_at,
          celsius
        )
        VALUES ($1, $2, $3, $4)
      `,
      [evidenceId, reading.sensorId, reading.recordedAt, reading.celsius]
    );
  }
}

function mapEvidenceRow(row: EvidenceRow): StoredTemperatureEvidence {
  return {
    evidenceId: row.evidence_id,
    batchId: row.batch_id,
    sensorId: row.sensor_id,
    evidenceHash: row.evidence_hash,
    minCelsius: Number(row.min_celsius),
    maxCelsius: Number(row.max_celsius),
    averageCelsius: Number(row.average_celsius),
    readingCount: row.reading_count,
    complianceOutcome: row.compliance_outcome,
    submissionStatus: row.submission_status,
    fabricTransactionId: row.fabric_transaction_id
  };
}

function mapReadingRow(row: ReadingRow): StoredTemperatureReading {
  return {
    sensorId: row.sensor_id,
    recordedAt: row.recorded_at instanceof Date ? row.recorded_at.toISOString() : row.recorded_at,
    celsius: Number(row.celsius)
  };
}
