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
  const readResponse = await fetch(
    `${backendUrl}/temperature/evidence/${encodeURIComponent(submission.evidenceId)}`,
    { headers: { "x-demo-identity": "oracle" } }
  );

  // From here on the transaction is committed, so every failure reports anchored: true.
  if (!readResponse.ok) {
    throw new AnchorError(
      `The evidence was submitted but could not be read back: ${await describeFailure(readResponse)}`,
      true
    );
  }

  const anchored = (await readResponse.json()) as AnchoredEvidence;
  if (!anchored.submittedTxId) {
    throw new AnchorError(
      "The evidence was submitted but the anchored record carried no transaction ID.",
      true
    );
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
