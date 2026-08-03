/**
 * Builds the regulator's independent verdict archive from Fabric compliance events.
 *
 * An event is checkpointed only after its verdict has been stored. If persistence fails, the stream
 * stops at that event so a restart can replay it rather than silently leaving a gap in the archive.
 */
import type {
  ArchivedVerdict,
  ComplianceEventName,
  SignatureCheck,
  VerdictRepository
} from "@fresh-milk/storage";

// Minimal event shape shared by the Fabric stream and unit tests.
export interface LedgerEvent {
  readonly eventName: string;
  readonly payload: Uint8Array;
}

export interface ComplianceEventDependencies<TEvent extends LedgerEvent = LedgerEvent> {
  readonly verdictRepository: VerdictRepository;
  // Persists progress so a restarted listener resumes after the last archived event.
  readonly checkpoint?: (event: TEvent) => Promise<void>;
  // Optional because only the regulator maintains this archive.
  readonly checkSignatures?: (evidenceId: string) => Promise<SignatureCheck>;
}

// Safe submissions and breaches use different Fabric event names.
const VERDICT_EVENTS: ReadonlySet<string> = new Set<ComplianceEventName>([
  "TemperatureEvidenceSubmitted",
  "ColdChainBreach"
]);

// Return the verdict so signature checking can reuse the parsed evidence ID.
/** Validates one Fabric event payload and stores the verdict it contains, if recognised. */
export async function applyComplianceEvent(
  event: LedgerEvent,
  verdictRepository: VerdictRepository
): Promise<ArchivedVerdict | undefined> {
  if (!VERDICT_EVENTS.has(event.eventName)) {
    return undefined;
  }

  const verdict = parseVerdict(event);
  if (!verdict) {
    // A malformed event is not worth stopping the stream for, and there is nothing to archive.
    console.error(`Ignored a ${event.eventName} event that could not be read.`);
    return undefined;
  }

  await verdictRepository.recordVerdict(verdict);
  return verdict;
}

/**
 * Consumes events in ledger order and advances the checkpoint only after a verdict is safely stored.
 * A failed archive write stops consumption so the same event can be replayed on restart.
 */
export async function consumeComplianceEvents<TEvent extends LedgerEvent>(
  events: AsyncIterable<TEvent>,
  dependencies: ComplianceEventDependencies<TEvent>
): Promise<void> {
  for await (const event of events) {
    let archived: ArchivedVerdict | undefined;
    try {
      archived = await applyComplianceEvent(event, dependencies.verdictRepository);
    } catch (error) {
      throw new Error(
        `Could not archive a ${event.eventName} event, so the listener stopped rather than ` +
          `checkpointing past it. Restart this backend to resume from the last archived event.`,
        { cause: error }
      );
    }

    if (archived) {
      await checkArchivedSignatures(archived.evidenceId, dependencies);
    }

    // Checkpoint only after the archive write succeeds.
    await dependencies.checkpoint?.(event);
  }
}

/** Records a signature result without allowing verification failure to stop event archiving. */
async function checkArchivedSignatures<TEvent extends LedgerEvent>(
  evidenceId: string,
  dependencies: ComplianceEventDependencies<TEvent>
): Promise<void> {
  if (!dependencies.checkSignatures) {
    return;
  }

  let outcome: SignatureCheck;
  try {
    outcome = await dependencies.checkSignatures(evidenceId);
  } catch {
    outcome = "UNKNOWN";
  }

  try {
    await dependencies.verdictRepository.recordSignatureCheck(evidenceId, outcome);
  } catch (error) {
    // The archive row remains UNKNOWN and can be checked again later.
    console.error(`Could not record the signature check for ${evidenceId}.`, error);
  }
}

// Reject malformed payloads before they reach the archive's NOT NULL constraints.
function parseVerdict(event: LedgerEvent): ArchivedVerdict | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(event.payload).toString());
  } catch {
    return undefined;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return undefined;
  }

  const candidate = parsed as Record<string, unknown>;
  const text = (field: string): string | undefined =>
    typeof candidate[field] === "string" && (candidate[field] as string).length > 0
      ? (candidate[field] as string)
      : undefined;

  const evidenceId = text("evidenceId");
  const batchId = text("batchId");
  const evidenceHash = text("evidenceHash");
  const submittedByStakeholderId = text("submittedByStakeholderId");
  const fabricTransactionId = text("txId");
  const ledgerTimestamp = text("timestamp");
  const outcome = candidate.complianceOutcome;

  if (
    !evidenceId ||
    !batchId ||
    !evidenceHash ||
    !submittedByStakeholderId ||
    !fabricTransactionId ||
    !ledgerTimestamp ||
    (outcome !== "COMPLIANT" && outcome !== "UNSAFE")
  ) {
    return undefined;
  }

  return {
    evidenceId,
    batchId,
    evidenceHash,
    complianceOutcome: outcome,
    submittedByStakeholderId,
    fabricTransactionId,
    ledgerTimestamp,
    eventName: event.eventName as ComplianceEventName
  };
}
