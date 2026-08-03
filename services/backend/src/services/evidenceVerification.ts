/**
 * Performs independent checks that can reveal altered or unverifiable evidence.
 *
 * Off-chain readings are compared with Fabric's hash and statistics, while sensor signatures are
 * checked against the regulator-attested key. Each result remains separate so an unavailable source
 * is reported as inconclusive instead of being mistaken for a successful match.
 */
import {
  calculateTemperatureStatistics,
  sensorPublicKey,
  sha256TemperatureReadings,
  verifyReadingSignature,
  type SignatureCheck,
  type StoredTemperatureReading,
  type TemperatureStatistics
} from "@fresh-milk/storage";

export interface AnchoredEvidence {
  // The batch ID comes from Fabric because it is part of the fingerprint.
  readonly batchId: string;
  readonly evidenceHash: string;
  readonly fabricTransactionId?: string | null;
  // The contract judged this summary, so it is verified separately from the hash.
  readonly statistics?: TemperatureStatistics;
}

export interface AnchoredEvidenceReader {
  getAnchoredEvidence(evidenceId: string): Promise<AnchoredEvidence | undefined>;
}

export interface RegisteredSensorKey {
  readonly publicKey: string;
  readonly active: boolean;
}

export type SignatureIssue =
  // At least one reading does not match its sensor signature.
  | "FORGED"
  | "SENSOR_NOT_REGISTERED"
  | "SENSOR_REVOKED"
  | "MIXED_SENSORS";

// The sensor key must come from Fabric, not from the party supplying the readings.
export interface SensorKeyReader {
  getSensorKey(sensorId: string): Promise<RegisteredSensorKey | undefined>;
}

export interface SourcedReadings {
  readonly readings: readonly StoredTemperatureReading[];
  // Available only when the verifier is also the database holder.
  readonly declaredHash?: string;
}

// The oracle reads locally. Other organisations fetch the readings from the oracle.
export interface ReadingsSource {
  getReadings(evidenceId: string): Promise<SourcedReadings | undefined>;
}

export interface EvidenceVerificationDependencies {
  readonly readingsSource: ReadingsSource;
  // The trusted comparison value must come from Fabric, not the readings holder.
  readonly anchoredEvidenceReader: AnchoredEvidenceReader;
  readonly sensorKeyReader: SensorKeyReader;
}

export interface EvidenceVerificationResult {
  readonly evidenceId: string;
  readonly batchId: string;
  readonly match: boolean;
  // Null when the verifier cannot read the holder's stored hash.
  readonly databaseHashMatchesAnchor: boolean | null;
  readonly anchoredHash: string;
  readonly databaseHash: string | null;
  readonly recomputedHash: string;
  // Null when the anchored record has no statistics to compare.
  readonly statisticsMatch: boolean | null;
  readonly anchoredStatistics: TemperatureStatistics | null;
  readonly recomputedStatistics: TemperatureStatistics;
  // Null means the signature check could not reach a verdict.
  readonly signaturesMatch: boolean | null;
  // Sequence numbers of readings with invalid signatures.
  readonly signatureFailures: readonly number[];
  // Distinguishes invalid signatures from sensor registration problems.
  readonly signatureIssue: SignatureIssue | null;
  // Always sourced from Fabric. Null when the anchor has no transaction ID.
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

/**
 * Recomputes each independently checkable claim and preserves `null` where a source cannot provide
 * a trustworthy answer. A missing answer is never reported as a match.
 */
export async function verifyTemperatureEvidence(
  evidenceId: string,
  dependencies: EvidenceVerificationDependencies
): Promise<EvidenceVerificationResult> {
  const normalisedEvidenceId = evidenceId.trim();

  // Fetch the independent off-chain and on-chain records concurrently.
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

  // Recompute the summary because it is not covered by the evidence hash.
  const anchoredStatistics = fabricEvidence.statistics ?? null;
  const recomputedStatistics = calculateTemperatureStatistics(readings);

  // Signature lookup failure does not discard the completed hash and statistics checks.
  const signatures = await checkSignatures(fabricEvidence.batchId, readings, dependencies);

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
    ...signatures,
    fabricTransactionId: fabricEvidence.fabricTransactionId ?? null
  };
}

/** Returns the regulator archive's three-state signature verdict for one evidence record. */
export async function checkEvidenceSignatures(
  evidenceId: string,
  dependencies: EvidenceVerificationDependencies
): Promise<SignatureCheck> {
  let result: EvidenceVerificationResult;
  try {
    result = await verifyTemperatureEvidence(evidenceId, dependencies);
  } catch {
    return "UNKNOWN";
  }

  if (result.signaturesMatch === null) {
    return "UNKNOWN";
  }
  return result.signaturesMatch ? "PASSED" : "FAILED";
}

/** Checks every reading against the sensor key registered on Fabric. */
async function checkSignatures(
  batchId: string,
  readings: readonly StoredTemperatureReading[],
  dependencies: EvidenceVerificationDependencies
): Promise<
  Pick<
    EvidenceVerificationResult,
    "signaturesMatch" | "signatureFailures" | "signatureIssue"
  >
> {
  const sensorIds = [...new Set(readings.map((reading) => reading.sensorId))];
  if (sensorIds.length !== 1) {
    return { signaturesMatch: false, signatureFailures: [], signatureIssue: "MIXED_SENSORS" };
  }

  let sensorKey: RegisteredSensorKey | undefined;
  try {
    sensorKey = await dependencies.sensorKeyReader.getSensorKey(sensorIds[0]);
  } catch {
    return { signaturesMatch: null, signatureFailures: [], signatureIssue: null };
  }

  // Registration failures concern the sensor, not individual reading signatures.
  if (!sensorKey) {
    return { signaturesMatch: false, signatureFailures: [], signatureIssue: "SENSOR_NOT_REGISTERED" };
  }
  if (!sensorKey.active) {
    return { signaturesMatch: false, signatureFailures: [], signatureIssue: "SENSOR_REVOKED" };
  }

  // Parse the shared key once for the complete reading set.
  const publicKey = sensorPublicKey(sensorKey.publicKey);
  const failures = readings
    .filter((reading) => !verifyReadingSignature({ ...reading, batchId }, reading.signature, publicKey))
    .map((reading) => reading.sequence);

  return {
    signaturesMatch: failures.length === 0,
    signatureFailures: failures,
    signatureIssue: failures.length === 0 ? null : "FORGED"
  };
}

// Both values use the storage package's shared rounding rules.
function statisticsAgree(
  anchored: TemperatureStatistics,
  recomputed: TemperatureStatistics
): boolean {
  return (
    anchored.minCelsius === recomputed.minCelsius &&
    anchored.maxCelsius === recomputed.maxCelsius &&
    anchored.readingCount === recomputed.readingCount
  );
}
