import {
  sha256TemperatureReadings,
  type StoredTemperatureReading,
  type TemperatureRepository
} from "@fresh-milk/storage";
import { canonicaliseReadings, type RawTemperatureReading } from "./canonicalise.js";
import { assessCompliance, calculateStatistics, type TemperatureStatistics } from "./compliance.js";
import { AnchorError } from "./oracleClient.js";
import type { AnchoredEvidence, TemperatureEvidenceSubmission } from "./oracleClient.js";

export interface OracleDependencies {
  readonly repository: TemperatureRepository;
  readonly anchor: (submission: TemperatureEvidenceSubmission) => Promise<AnchoredEvidence>;
  // Reads what is already on the ledger for an evidence ID. The ID is derived from the readings,
  // so the contract refuses a second submission of the same run: when anchoring fails after the
  // transaction landed, adopting the existing record is the only way the run can finish.
  readonly readAnchored: (evidenceId: string) => Promise<AnchoredEvidence | undefined>;
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

// Every reading in one run must describe the same batch, otherwise the fingerprint would cover
// readings from several batches and could never be verified against a single ledger record.
function singleBatchId(batchIds: readonly string[]): string {
  const unique = [...new Set(batchIds)];
  if (unique.length !== 1) {
    throw new Error(
      `Readings must all belong to one batch, found: ${unique.join(", ") || "none"}.`
    );
  }
  return unique[0];
}

export async function runOracle(
  rawReadings: readonly RawTemperatureReading[],
  dependencies: OracleDependencies
): Promise<OracleResult> {
  const canonicalReadings = canonicaliseReadings(rawReadings);
  const batchId = singleBatchId(canonicalReadings.map((reading) => reading.batchId));
  const statistics = calculateStatistics(canonicalReadings);

  const readings: readonly StoredTemperatureReading[] = canonicalReadings.map((reading) => ({
    sensorId: reading.sensorId,
    recordedAt: reading.recordedAt,
    celsius: reading.celsius
  }));

  // Hashed with the storage package's function, the same one verification and the tamper demo
  // use, so the three can never disagree about what the fingerprint covers.
  const evidenceHash = sha256TemperatureReadings(batchId, readings);

  // Derived from the content so the same readings always produce the same ID, and resubmitting
  // them is rejected as a duplicate rather than silently anchored twice.
  const evidenceId = `EV-${batchId}-${evidenceHash.slice(0, 8)}`;

  // Saved before anchoring and left PENDING, so a failed submission is never mistaken for
  // evidence that made it onto the ledger.
  await dependencies.repository.saveEvidence(
    {
      evidenceId,
      batchId,
      sensorId: readings[0].sensorId,
      evidenceHash,
      minCelsius: statistics.minCelsius,
      maxCelsius: statistics.maxCelsius,
      averageCelsius: statistics.averageCelsius,
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

  // Deliberately outside the failure handling above. If this write fails the anchor is not lost,
  // and the row stays PENDING for the next run to repair from the ledger, rather than committed
  // evidence being recorded as a failure.
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
    // Anchoring reports failure for reasons that do not tell us whether the transaction reached
    // the ledger, so the ledger itself is asked before anything is written off as a failure.
    let onLedger: AnchoredEvidence | undefined;
    let ledgerAnswered = false;
    try {
      onLedger = await dependencies.readAnchored(submission.evidenceId);
      ledgerAnswered = true;
    } catch {
      // Being unable to check is not evidence of anything, so the row is left alone below.
    }

    if (onLedger) {
      return onLedger;
    }

    // Marked failed only on positive proof: the anchor step reported the transaction never landed
    // and the ledger confirms nothing is there. Anything less leaves the row PENDING, which the
    // next run can still repair.
    if (ledgerAnswered && (!(error instanceof AnchorError) || !error.anchored)) {
      await dependencies.repository.markFailed(submission.evidenceId);
    }
    throw error;
  }
}
