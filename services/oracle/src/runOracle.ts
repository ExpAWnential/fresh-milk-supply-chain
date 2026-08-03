/**
 * Runs the complete oracle workflow for one set of sensor readings.
 *
 * Readings are verified and stored before their summary is submitted to Fabric. The workflow also
 * handles the awkward case where Fabric commits a transaction but the client loses the response,
 * so a retry can recover without replacing evidence that is already anchored.
 */
import {
  calculateTemperatureStatistics,
  sha256TemperatureReadings,
  type StoredTemperatureReading,
  type TemperatureRepository,
  type TemperatureStatistics
} from "@fresh-milk/storage";
import {
  canonicaliseReadings,
  type CanonicalTemperatureReading,
  type RawTemperatureReading
} from "./canonicalise.js";
import { assessCompliance } from "./compliance.js";
import { AnchorError } from "./oracleClient.js";
import type { AnchoredEvidence, TemperatureEvidenceSubmission } from "./oracleClient.js";

export interface OracleDependencies {
  readonly repository: TemperatureRepository;
  readonly anchor: (submission: TemperatureEvidenceSubmission) => Promise<AnchoredEvidence>;
  // Used to recover when Fabric commits a transaction but the client misses the response.
  readonly readAnchored: (evidenceId: string) => Promise<AnchoredEvidence | undefined>;
  // Rejects readings that fail the registered sensor's signature checks.
  readonly verifyReadings: (readings: readonly CanonicalTemperatureReading[]) => Promise<void>;
}

export interface OracleResult {
  readonly evidenceId: string;
  readonly batchId: string;
  readonly readingCount: number;
  readonly statistics: TemperatureStatistics;
  readonly evidenceHash: string;
  // Reported by the contract, not by this process.
  readonly complianceOutcome: AnchoredEvidence["complianceOutcome"];
  readonly fabricTransactionId: string;
}

// An evidence record belongs to exactly one batch.
function singleBatchId(batchIds: readonly string[]): string {
  const unique = [...new Set(batchIds)];
  if (unique.length !== 1) {
    throw new Error(
      `Readings must all belong to one batch, found: ${unique.join(", ") || "none"}.`
    );
  }
  return unique[0];
}

/**
 * Verifies and stores a complete sensor run before anchoring its evidence on Fabric.
 * A retry reconciles uncertain submissions against the ledger before changing local status.
 */
export async function runOracle(
  rawReadings: readonly RawTemperatureReading[],
  dependencies: OracleDependencies
): Promise<OracleResult> {
  const canonicalReadings = canonicaliseReadings(rawReadings);

  // Verify first so invalid sensor data is never stored or anchored.
  await dependencies.verifyReadings(canonicalReadings);

  const batchId = singleBatchId(canonicalReadings.map((reading) => reading.batchId));
  const statistics = calculateTemperatureStatistics(canonicalReadings);

  // The parent evidence row stores the batch ID. Each reading keeps the fields needed for an
  // independent signature check.
  const readings: readonly StoredTemperatureReading[] = canonicalReadings.map((reading) => ({
    sensorId: reading.sensorId,
    sequence: reading.sequence,
    recordedAt: reading.recordedAt,
    celsius: reading.celsius,
    signature: reading.signature
  }));

  // Verification uses the same canonical hash function to detect later changes.
  const evidenceHash = sha256TemperatureReadings(batchId, readings);

  // A content-derived ID makes retries refer to the same evidence record.
  const evidenceId = `EV-${batchId}-${evidenceHash.slice(0, 8)}`;

  // Store first as PENDING. Only a confirmed Fabric transaction changes it to ANCHORED.
  await dependencies.repository.saveEvidence(
    {
      evidenceId,
      batchId,
      sensorId: readings[0].sensorId,
      evidenceHash,
      minCelsius: statistics.minCelsius,
      maxCelsius: statistics.maxCelsius,
      readingCount: statistics.readingCount,
      complianceOutcome: assessCompliance(statistics),
      submissionStatus: "PENDING",
      fabricTransactionId: null
    },
    readings
  );

  const anchored = await anchorEvidence(dependencies, {
    evidenceId,
    batchId,
    evidenceHash,
    offChainReference: `postgres://temperature_evidence/${evidenceId}`,
    statistics
  });

  // If this update fails, a retry can recover the committed transaction from Fabric.
  await dependencies.repository.markAnchored(evidenceId, anchored.submittedTxId);

  return {
    evidenceId,
    batchId,
    readingCount: statistics.readingCount,
    statistics,
    evidenceHash,
    complianceOutcome: anchored.complianceOutcome,
    fabricTransactionId: anchored.submittedTxId
  };
}

async function anchorEvidence(
  dependencies: OracleDependencies,
  submission: TemperatureEvidenceSubmission
): Promise<AnchoredEvidence> {
  try {
    return await dependencies.anchor(submission);
  } catch (error) {
    // A client error may occur after commit, so check the ledger before marking the row failed.
    let onLedger: AnchoredEvidence | undefined;
    let ledgerAnswered = false;
    try {
      onLedger = await dependencies.readAnchored(submission.evidenceId);
      ledgerAnswered = true;
    } catch {
      // Leave the row PENDING when Fabric cannot confirm either outcome.
    }

    if (onLedger) {
      return onLedger;
    }

    // Mark FAILED only when Fabric answered and no committed record exists.
    if (ledgerAnswered && (!(error instanceof AnchorError) || !error.anchored)) {
      await dependencies.repository.markFailed(submission.evidenceId);
    }
    throw error;
  }
}
