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
  sensorPublicKey,
  sha256TemperatureReadings,
  verifyReadingSignature,
  type SignatureCheck,
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

export interface RegisteredSensorKey {
  readonly publicKey: string;
  readonly active: boolean;
}

export type SignatureIssue =
  // A reading does not match the signature beside it: somebody altered it after the sensor
  // recorded it. This is the only one of these that is an accusation.
  | "FORGED"
  // No regulator ever vouched for this sensor, so there is nothing to check against.
  | "SENSOR_NOT_REGISTERED"
  // The regulator has since disowned this sensor. Its signatures may still be mathematically
  // valid; they are simply no longer accepted.
  | "SENSOR_REVOKED"
  // One evidence record names one sensor, so readings from two of them never belonged together.
  | "MIXED_SENSORS";

// Read off the ledger with this company's own certificate, never taken from the party holding the
// readings. Checking a holder's data against a key the same holder supplied would prove nothing.
// Undefined means the ledger positively has no key for that sensor.
export interface SensorKeyReader {
  getSensorKey(sensorId: string): Promise<RegisteredSensorKey | undefined>;
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
  readonly sensorKeyReader: SensorKeyReader;
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
  // Whether every reading still carries a signature the registered sensor could have produced. The
  // hash above says the readings are unchanged since they were anchored; this says they were true
  // when they arrived, which the oracle computing its own hash could never establish.
  // Null when no key could be read, never true: an unreachable ledger has to look different from a
  // verified one, or a dishonest oracle need only make the lookup fail.
  readonly signaturesMatch: boolean | null;
  // Which readings failed their own signature, by sequence number, so a report names the row rather
  // than the batch. Empty when the readings are fine, and also when the problem is not with any
  // individual signature: see below.
  readonly signatureFailures: readonly number[];
  // Why the signatures were not accepted, when they were not. A revoked sensor is not a forged
  // reading, and reporting one as the other accuses a company of something it did not do. Null when
  // there is nothing wrong or nothing could be checked.
  readonly signatureIssue: SignatureIssue | null;
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

  // Left until after the two comparisons above so a company with no reachable ledger key still
  // gets the hash and statistics answers rather than nothing at all.
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
    // Only ever the ledger's. Falling back to the database's copy would hand an auditor a
    // transaction ID from the very record they are checking, under a field that says otherwise.
    fabricTransactionId: fabricEvidence.fabricTransactionId ?? null
  };
}

/**
 * The signature verdict on its own, for a caller that wants only that: the regulator's event
 * listener, checking each verdict as it lands rather than waiting to be asked.
 *
 * Anything that stops the check finishing is UNKNOWN, never FAILED. FAILED is an accusation about
 * a company's evidence and it has to be earned by actually checking; an oracle that is simply down
 * has not been shown to have done anything wrong. The two are separate columns in the archive for
 * the same reason.
 */
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

/**
 * Checks each reading against the key the regulator registered for its sensor.
 *
 * This is the half the oracle cannot fake. It can recompute a hash over anything it stores, and it
 * can summarise those readings however it likes, but it holds no sensor private key, so a reading
 * it altered cannot be made to fit the signature beside it. Running the check here, in a company
 * that does not hold the readings, is what turns that from something the oracle claims into
 * something anyone can confirm.
 *
 * Everything unresolvable reports null rather than false or true. False would accuse a holder on
 * the strength of a ledger we could not read, and true would let a dishonest oracle pass simply by
 * making the lookup fail.
 */
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

  // Neither of these is a forged reading, and neither is reported as one. A sensor nobody vouched
  // for cannot be checked at all; a revoked one may still carry perfectly valid signatures that are
  // simply no longer accepted. Listing every reading as failed under either would accuse a company
  // of tampering it never did.
  if (!sensorKey) {
    return { signaturesMatch: false, signatureFailures: [], signatureIssue: "SENSOR_NOT_REGISTERED" };
  }
  if (!sensorKey.active) {
    return { signaturesMatch: false, signatureFailures: [], signatureIssue: "SENSOR_REVOKED" };
  }

  // Parsed once for the whole run rather than per reading.
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

// Both sides are produced by the storage package's calculator, which rounds to three decimals, so
// they are directly comparable rather than needing a tolerance.
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
