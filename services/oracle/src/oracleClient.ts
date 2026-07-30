/**
 * The oracle's HTTP calls to the backend: submit evidence, and read an anchored record back.
 *
 * Its job is to report precisely what happened, in particular whether a failed submission still
 * reached the ledger, because that is what decides whether a run can be repaired.
 */
import type { TemperatureStatistics } from "./compliance.js";

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

// Whether the transaction reached the ledger before things went wrong. A submission that was
// committed but could not be read back afterwards is not a failure to anchor, and must not be
// recorded as one: the evidence is on the ledger and cannot be submitted again.
export class AnchorError extends Error {
  public constructor(
    message: string,
    public readonly anchored: boolean
  ) {
    super(message);
    this.name = "AnchorError";
  }
}

const backendUrl = process.env.BACKEND_URL ?? "http://localhost:3000";

// The compliance outcome is deliberately absent from the submission. The oracle reports the
// statistics and the contract decides, so a compromised oracle cannot declare unsafe milk safe.
export async function submitTemperatureEvidence(
  submission: TemperatureEvidenceSubmission
): Promise<AnchoredEvidence> {
  const anchorResponse = await fetch(
    `${backendUrl}/temperature/batches/${encodeURIComponent(submission.batchId)}/evidence`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-demo-identity": "oracle"
      },
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

  // Read the anchored record back so the off-chain row can be linked to the real transaction,
  // which also confirms the evidence is genuinely on the ledger.
  // From here on the transaction is committed, so every failure reports anchored: true.
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

// Undefined means the ledger positively has no such evidence, which the backend reports as a 404.
// Every other failure throws, because being unable to tell must never be read as "never anchored":
// that is the difference between a run that can be repaired and one recorded as failed forever.
export async function readAnchoredEvidence(
  evidenceId: string
): Promise<AnchoredEvidence | undefined> {
  const response = await fetch(
    `${backendUrl}/temperature/evidence/${encodeURIComponent(evidenceId)}`,
    { headers: { "x-demo-identity": "oracle" } }
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
