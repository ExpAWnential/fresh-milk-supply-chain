/**
 * The tamper check. Two comparisons against the stored readings, answering different questions.
 *
 * The hash asks whether the readings were edited after they were anchored. The statistics ask
 * whether the summary the contract passed judgement on ever described those readings, which the
 * hash cannot tell you because it does not cover that summary.
 *
 * Whether the readings changed and whether the holder's own copy of the hash changed are reported
 * separately too, because those point at different culprits.
 *
 * The readings and the anchor deliberately come from different places. Any company can run this:
 * it fetches the readings from whoever holds them, reads the anchor off the ledger with its own
 * certificate, and does the arithmetic itself. That is what makes it a check on the holder rather
 * than a report from them.
 */
import {
  calculateTemperatureStatistics,
  sha256TemperatureReadings,
  type StoredTemperatureReading,
  type TemperatureStatistics
} from "@fresh-milk/storage";

export interface AnchoredEvidence {
  // The fingerprint covers the batch ID as well as the readings, and this is the ledger's copy of
  // it. Recomputing from the holder's copy would let a party that altered its own batch_id column
  // still produce a matching hash.
  readonly batchId: string;
  readonly evidenceHash: string;
  readonly fabricTransactionId?: string | null;
  // The summary the contract derived its verdict from. The hash covers the readings but not this,
  // so without it there is no way to tell whether the verdict was reached from the real numbers.
  readonly statistics?: TemperatureStatistics;
}

export interface AnchoredEvidenceReader {
  getAnchoredEvidence(evidenceId: string): Promise<AnchoredEvidence | undefined>;
}

export interface SourcedReadings {
  readonly readings: readonly StoredTemperatureReading[];
  // What the holder's own record claims the fingerprint is. Only a company that holds the row can
  // answer this, so it is absent when the readings arrived over HTTP from the company that does.
  readonly declaredHash?: string;
}

// Where the readings come from. The oracle reads its own database; everyone else asks the oracle
// for them over HTTP, which is what makes this a cross-company check rather than a self-report.
export interface ReadingsSource {
  getReadings(evidenceId: string): Promise<SourcedReadings | undefined>;
}

export interface EvidenceVerificationDependencies {
  readonly readingsSource: ReadingsSource;
  // Required. Comparing a holder's hash against that same holder's readings proves nothing,
  // because both move together when a row is altered. The anchor has to come off the ledger.
  readonly anchoredEvidenceReader: AnchoredEvidenceReader;
}

export interface EvidenceVerificationResult {
  readonly evidenceId: string;
  readonly batchId: string;
  // Whether the stored readings still hash to what the ledger anchored.
  readonly match: boolean;
  // Whether the holder's own record of the hash also matches the ledger. A false here with a true
  // above would mean the stored hash was altered rather than the readings.
  // Null when the readings came from another company, which publishes readings and not its
  // bookkeeping. It is not needed for the check above and proves nothing on its own.
  readonly databaseHashMatchesAnchor: boolean | null;
  readonly anchoredHash: string;
  readonly databaseHash: string | null;
  readonly recomputedHash: string;
  // Whether the summary the contract judged actually describes the stored readings. A hash match
  // with this false means nobody edited the readings, but the oracle's summary of them was wrong,
  // so the verdict on the ledger was reached from numbers that were never true.
  // Null when the anchored record carried no statistics to compare against.
  readonly statisticsMatch: boolean | null;
  readonly anchoredStatistics: TemperatureStatistics | null;
  readonly recomputedStatistics: TemperatureStatistics;
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

  // The two reads are independent and come from different parties, so neither waits on the other.
  // A source that holds the row raises EVIDENCE_NOT_FOUND or EVIDENCE_NOT_ANCHORED from in here,
  // because only a holder can tell those apart.
  const [sourced, fabricEvidence] = await Promise.all([
    dependencies.readingsSource.getReadings(normalisedEvidenceId),
    dependencies.anchoredEvidenceReader.getAnchoredEvidence(normalisedEvidenceId)
  ]);

  if (!sourced || sourced.readings.length === 0) {
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

  const readings = sourced.readings;
  const anchoredHash = fabricEvidence.evidenceHash.toLowerCase();
  const databaseHash = sourced.declaredHash?.toLowerCase() ?? null;
  const recomputedHash = sha256TemperatureReadings(fabricEvidence.batchId, readings);

  // The hash proves the readings were not edited after anchoring. It says nothing about whether
  // the summary sent alongside it described those readings, and the summary is what the contract
  // judged, so an oracle could store honest readings and anchor a flattering summary of them.
  const anchoredStatistics = fabricEvidence.statistics ?? null;
  const recomputedStatistics = calculateTemperatureStatistics(readings);

  return {
    evidenceId: normalisedEvidenceId,
    batchId: fabricEvidence.batchId,
    match: recomputedHash === anchoredHash,
    databaseHashMatchesAnchor: databaseHash === null ? null : databaseHash === anchoredHash,
    anchoredHash,
    databaseHash,
    recomputedHash,
    statisticsMatch: anchoredStatistics
      ? statisticsAgree(anchoredStatistics, recomputedStatistics)
      : null,
    anchoredStatistics,
    recomputedStatistics,
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
