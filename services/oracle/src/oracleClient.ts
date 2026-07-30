export interface TemperatureEvidenceSubmission {
  readonly evidenceId: string;
  readonly batchId: string;
  readonly evidenceHash: string;
  readonly offChainReference: string;
  readonly statistics: {
    readonly minCelsius: number;
    readonly maxCelsius: number;
    readonly averageCelsius: number;
    readonly readingCount: number;
  };
}

export interface AnchoredEvidence {
  readonly submittedTxId: string;
  readonly complianceOutcome: "COMPLIANT" | "UNSAFE";
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
    throw new Error(await describeFailure(anchorResponse));
  }

  // Read the anchored record back so the off-chain row can be linked to the real transaction,
  // which also confirms the evidence is genuinely on the ledger.
  const readResponse = await fetch(
    `${backendUrl}/temperature/evidence/${encodeURIComponent(submission.evidenceId)}`,
    { headers: { "x-demo-identity": "oracle" } }
  );

  if (!readResponse.ok) {
    throw new Error(await describeFailure(readResponse));
  }

  const anchored = (await readResponse.json()) as AnchoredEvidence;
  if (!anchored.submittedTxId) {
    throw new Error("The anchored evidence did not include a transaction ID.");
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
