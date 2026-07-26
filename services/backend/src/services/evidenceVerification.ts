import {
  sha256TemperatureReadings,
  type TemperatureRepository
} from "@fresh-milk/storage";

export interface AnchoredEvidence {
  readonly evidenceHash: string;
  readonly fabricTransactionId?: string | null;
}

export interface AnchoredEvidenceReader {
  getAnchoredEvidence(evidenceId: string): Promise<AnchoredEvidence | undefined>;
}

export interface EvidenceVerificationDependencies {
  readonly temperatureRepository: TemperatureRepository;
  readonly anchoredEvidenceReader?: AnchoredEvidenceReader;
}

export interface EvidenceVerificationResult {
  readonly evidenceId: string;
  readonly batchId: string;
  readonly match: boolean;
  readonly databaseHashMatchesAnchor: boolean;
  readonly anchoredHash: string;
  readonly databaseHash: string;
  readonly recomputedHash: string;
  readonly readingCount: number;
  readonly fabricTransactionId: string;
  readonly anchorSource: "FABRIC" | "CONFIRMED_DATABASE_RECORD";
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

  const readings = await dependencies.temperatureRepository.getReadings(normalisedEvidenceId);
  if (readings.length === 0) {
    throw new EvidenceVerificationError(
      "READINGS_NOT_FOUND",
      `Evidence '${normalisedEvidenceId}' has no off-chain readings.`
    );
  }

  const fabricEvidence = dependencies.anchoredEvidenceReader
    ? await dependencies.anchoredEvidenceReader.getAnchoredEvidence(normalisedEvidenceId)
    : undefined;
  if (dependencies.anchoredEvidenceReader && !fabricEvidence) {
    throw new EvidenceVerificationError(
      "ANCHORED_EVIDENCE_NOT_FOUND",
      `Evidence '${normalisedEvidenceId}' does not exist on Fabric.`
    );
  }

  const anchoredHash = (fabricEvidence?.evidenceHash ?? evidence.evidenceHash).toLowerCase();
  const databaseHash = evidence.evidenceHash.toLowerCase();
  const recomputedHash = sha256TemperatureReadings(evidence.batchId, readings);

  return {
    evidenceId: normalisedEvidenceId,
    batchId: evidence.batchId,
    match: recomputedHash === anchoredHash,
    databaseHashMatchesAnchor: databaseHash === anchoredHash,
    anchoredHash,
    databaseHash,
    recomputedHash,
    readingCount: readings.length,
    fabricTransactionId:
      fabricEvidence?.fabricTransactionId ?? evidence.fabricTransactionId,
    anchorSource: fabricEvidence ? "FABRIC" : "CONFIRMED_DATABASE_RECORD"
  };
}
