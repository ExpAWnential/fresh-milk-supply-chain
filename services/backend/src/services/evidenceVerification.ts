/**
 * The tamper check. Two comparisons against the stored readings, answering different questions.
 *
 * The hash asks whether the readings were edited after they were anchored. The statistics ask
 * whether the summary the contract passed judgement on ever described those readings, which the
 * hash cannot tell you because it does not cover that summary.
 *
 * Whether the readings changed and whether the database's own copy of the hash changed are
 * reported separately too, because those point at different culprits.
 */
import {
  calculateTemperatureStatistics,
  sha256TemperatureReadings,
  type TemperatureRepository,
  type TemperatureStatistics
} from "@fresh-milk/storage";

export interface AnchoredEvidence {
  readonly evidenceHash: string;
  readonly fabricTransactionId?: string | null;
  // The summary the contract derived its verdict from. The hash covers the readings but not this,
  // so without it there is no way to tell whether the verdict was reached from the real numbers.
  readonly statistics?: TemperatureStatistics;
}

export interface AnchoredEvidenceReader {
  getAnchoredEvidence(evidenceId: string): Promise<AnchoredEvidence | undefined>;
}

export interface EvidenceVerificationDependencies {
  readonly temperatureRepository: TemperatureRepository;
  // Required. Comparing the stored hash against readings from that same database proves nothing,
  // because both move together when a row is altered. The anchor has to come off the ledger.
  readonly anchoredEvidenceReader: AnchoredEvidenceReader;
}

export interface EvidenceVerificationResult {
  readonly evidenceId: string;
  readonly batchId: string;
  // Whether the stored readings still hash to what the ledger anchored.
  readonly match: boolean;
  // Whether the database's own record of the hash also matches the ledger. A false here with a
  // true above would mean the stored hash was altered rather than the readings.
  readonly databaseHashMatchesAnchor: boolean;
  readonly anchoredHash: string;
  readonly databaseHash: string;
  readonly recomputedHash: string;
  // Whether the summary the contract judged actually describes the stored readings. A hash match
  // with this false means nobody edited the readings, but the oracle's summary of them was wrong,
  // so the verdict on the ledger was reached from numbers that were never true.
  // Null when the anchored record carried no statistics to compare against.
  readonly statisticsMatch: boolean | null;
  readonly anchoredStatistics: TemperatureStatistics | null;
  readonly recomputedStatistics: TemperatureStatistics;
  readonly readingCount: number;
  // Null when the anchored record carries no transaction ID. Reported as missing rather than
  // filled in from the database, so this field always means what it says.
  readonly fabricTransactionId: string | null;
}

export type EvidenceVerificationErrorCode =
  | "EVIDENCE_NOT_FOUND"
  | "EVIDENCE_NOT_ANCHORED"
  | "ANCHORED_EVIDENCE_NOT_FOUND"
  | "READINGS_NOT_FOUND";

export class EvidenceVerificationError extends Error {
  public constructor(
    public readonly code: EvidenceVerificationErrorCode,
    message: string
  ) {
    super(message);
    this.name = "EvidenceVerificationError";
  }
}

export async function verifyTemperatureEvidence(
  evidenceId: string,
  dependencies: EvidenceVerificationDependencies
): Promise<EvidenceVerificationResult> {
  const normalisedEvidenceId = evidenceId.trim();
  const evidence = await dependencies.temperatureRepository.getEvidence(normalisedEvidenceId);
  if (!evidence) {
    throw new EvidenceVerificationError(
      "EVIDENCE_NOT_FOUND",
      `Evidence '${normalisedEvidenceId}' does not exist.`
    );
  }
  if (evidence.submissionStatus !== "ANCHORED" || !evidence.fabricTransactionId) {
    throw new EvidenceVerificationError(
      "EVIDENCE_NOT_ANCHORED",
      `Evidence '${normalisedEvidenceId}' has not been anchored to Fabric.`
    );
  }

  // The database read and the ledger read are independent, so neither waits on the other.
  const [readings, fabricEvidence] = await Promise.all([
    dependencies.temperatureRepository.getReadings(normalisedEvidenceId),
    dependencies.anchoredEvidenceReader.getAnchoredEvidence(normalisedEvidenceId)
  ]);

  if (readings.length === 0) {
    throw new EvidenceVerificationError(
      "READINGS_NOT_FOUND",
      `Evidence '${normalisedEvidenceId}' has no off-chain readings.`
    );
  }
  if (!fabricEvidence) {
    throw new EvidenceVerificationError(
      "ANCHORED_EVIDENCE_NOT_FOUND",
      `Evidence '${normalisedEvidenceId}' does not exist on Fabric.`
    );
  }

  const anchoredHash = fabricEvidence.evidenceHash.toLowerCase();
  const databaseHash = evidence.evidenceHash.toLowerCase();
  const recomputedHash = sha256TemperatureReadings(evidence.batchId, readings);

  // The hash proves the readings were not edited after anchoring. It says nothing about whether
  // the summary sent alongside it described those readings, and the summary is what the contract
  // judged, so an oracle could store honest readings and anchor a flattering summary of them.
  const anchoredStatistics = fabricEvidence.statistics ?? null;
  const recomputedStatistics = calculateTemperatureStatistics(readings);

  return {
    evidenceId: normalisedEvidenceId,
    batchId: evidence.batchId,
    match: recomputedHash === anchoredHash,
    databaseHashMatchesAnchor: databaseHash === anchoredHash,
    anchoredHash,
    databaseHash,
    recomputedHash,
    statisticsMatch: anchoredStatistics
      ? statisticsAgree(anchoredStatistics, recomputedStatistics)
      : null,
    anchoredStatistics,
    recomputedStatistics,
    readingCount: readings.length,
    // Only ever the ledger's. Falling back to the database's copy would hand an auditor a
    // transaction ID from the very record they are checking, under a field that says otherwise.
    fabricTransactionId: fabricEvidence.fabricTransactionId ?? null
  };
}

// Both sides are produced by the storage package's calculator, which rounds to three decimals, so
// they are directly comparable rather than needing a tolerance.
function statisticsAgree(
  anchored: TemperatureStatistics,
  recomputed: TemperatureStatistics
): boolean {
  return (
    anchored.minCelsius === recomputed.minCelsius &&
    anchored.maxCelsius === recomputed.maxCelsius &&
    anchored.averageCelsius === recomputed.averageCelsius &&
    anchored.readingCount === recomputed.readingCount
  );
}
