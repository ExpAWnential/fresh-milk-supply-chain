/**
 * Provides the oracle's HTTP boundary to Fabric-backed operations.
 *
 * Submission failures are not assumed to mean rejection because a transaction may have committed
 * before the response was lost. Callers can read the anchored record to resolve that uncertainty.
 */
import type { TemperatureStatistics } from "@fresh-milk/storage";
import type { SensorPublicKey } from "./verifyReadings.js";

export interface TemperatureEvidenceSubmission {
  readonly evidenceId: string;
  readonly batchId: string;
  readonly evidenceHash: string;
  readonly offChainReference: string;
  readonly statistics: TemperatureStatistics;
}

export interface AnchoredEvidence {
  readonly submittedTxId: string;
  readonly complianceOutcome: "COMPLIANT" | "UNSAFE";
}

// A failure after commit remains anchored because Fabric will reject resubmission of the same ID.
export class AnchorError extends Error {
  public constructor(
    message: string,
    public readonly anchored: boolean
  ) {
    super(message);
    this.name = "AnchorError";
  }
}

// Only the oracle backend holds the certificate authorised to submit evidence.
const backendUrl = process.env.BACKEND_URL ?? "http://localhost:3006";

// Submit statistics, not a verdict. The contract derives compliance and verification recomputes
// the statistics from the raw readings.
/** Submits one evidence summary through the backend that owns the oracle's Fabric identity. */
export async function submitTemperatureEvidence(
  submission: TemperatureEvidenceSubmission
): Promise<AnchoredEvidence> {
  const anchorResponse = await fetch(
    `${backendUrl}/temperature/batches/${encodeURIComponent(submission.batchId)}/evidence`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        evidenceId: submission.evidenceId,
        evidenceHash: submission.evidenceHash,
        offChainReference: submission.offChainReference,
        statistics: submission.statistics
      })
    }
  );

  if (!anchorResponse.ok) {
    throw new AnchorError(await describeFailure(anchorResponse), false);
  }

  // Read back the committed record to capture its real transaction ID.
  let anchored: AnchoredEvidence | undefined;
  try {
    anchored = await readAnchoredEvidence(submission.evidenceId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new AnchorError(`The evidence was submitted but could not be read back: ${reason}`, true);
  }

  if (!anchored) {
    throw new AnchorError(
      "The evidence was submitted but no anchored record could be found for it.",
      true
    );
  }

  return anchored;
}

/**
 * Reads back Fabric's committed evidence record. A confirmed 404 means no anchor exists, while
 * transport and server failures remain inconclusive and are allowed to throw.
 */
export async function readAnchoredEvidence(
  evidenceId: string
): Promise<AnchoredEvidence | undefined> {
  const response = await fetch(
    `${backendUrl}/temperature/evidence/${encodeURIComponent(evidenceId)}`
  );

  if (response.status === 404) {
    return undefined;
  }

  if (!response.ok) {
    throw new Error(await describeFailure(response));
  }

  const anchored = (await response.json()) as AnchoredEvidence;
  if (!anchored.submittedTxId) {
    throw new Error("The anchored record carried no transaction ID.");
  }

  return anchored;
}

/** Reads a regulator-attested sensor key from Fabric. Only a confirmed 404 returns undefined. */
export async function readSensorPublicKey(
  sensorId: string
): Promise<SensorPublicKey | undefined> {
  const response = await fetch(`${backendUrl}/sensors/${encodeURIComponent(sensorId)}`);

  if (response.status === 404) {
    return undefined;
  }

  if (!response.ok) {
    throw new Error(await describeFailure(response));
  }

  const sensorKey = (await response.json()) as SensorPublicKey;
  if (!sensorKey.publicKey) {
    throw new Error(`The registered record for sensor '${sensorId}' carried no public key.`);
  }

  return sensorKey;
}

async function describeFailure(response: Response): Promise<string> {
  const body = await response.text();
  try {
    const parsed = JSON.parse(body) as { error?: string };
    if (parsed.error) {
      return parsed.error;
    }
  } catch {
    // Fall through to the raw body below.
  }

  return `The backend rejected the request (${response.status}): ${body.slice(0, 200)}`;
}
