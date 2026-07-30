import {
  sha256TemperatureReadings,
  type StoredTemperatureReading,
  type TemperatureRepository
} from "@fresh-milk/storage";
import { canonicaliseReadings, type RawTemperatureReading } from "./canonicalise.js";
import { assessCompliance, calculateStatistics, type TemperatureStatistics } from "./compliance.js";
import type { AnchoredEvidence, TemperatureEvidenceSubmission } from "./oracleClient.js";

export interface OracleDependencies {
  readonly repository: TemperatureRepository;
  readonly anchor: (submission: TemperatureEvidenceSubmission) => Promise<AnchoredEvidence>;
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

  try {
    const anchored = await dependencies.anchor({
      evidenceId,
      batchId,
      evidenceHash,
      offChainReference: `postgres://temperature_evidence/${evidenceId}`,
      statistics
    });
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
  } catch (error) {
    await dependencies.repository.markFailed(evidenceId);
    throw error;
  }
}
