/**
 * Builds the regulator's archive from the ledger's own compliance events.
 *
 * Every row it writes is what the contract decided, taken from the event the contract emitted.
 * The oracle's opinion of the same readings lives in the oracle's own database and is never
 * copied here, which is what makes the two comparable.
 */
import type {
  ArchivedVerdict,
  ComplianceEventName,
  SignatureCheck,
  VerdictRepository
} from "@fresh-milk/storage";

// The shape this consumer needs from a chaincode event, so it can be exercised without a network.
export interface LedgerEvent {
  readonly eventName: string;
  readonly payload: Uint8Array;
}

// Parameterised by the event type so the checkpoint callback receives whatever the stream yields,
// rather than the narrower shape this module reads.
export interface ComplianceEventDependencies<TEvent extends LedgerEvent = LedgerEvent> {
  readonly verdictRepository: VerdictRepository;
  // Records that an event has been dealt with, so a restart resumes after it instead of at the
  // start of the chain. Omitted where resuming does not matter.
  readonly checkpoint?: (event: TEvent) => Promise<void>;
  // Checks the sensor signatures behind a verdict the moment it arrives, so a forged reading is
  // found in seconds by the party whose job it is to notice, rather than whenever somebody happens
  // to click verify. Omitted by a company that keeps no archive.
  readonly checkSignatures?: (evidenceId: string) => Promise<SignatureCheck>;
}

// The contract announces its verdict under a different name depending on which way it went, and
// both have to be archived. Listening only to the safe one would leave the regulator with no
// record of a breach, which is the one that matters most.
const VERDICT_EVENTS: ReadonlySet<string> = new Set<ComplianceEventName>([
  "TemperatureEvidenceSubmitted",
  "ColdChainBreach"
]);

// Returns what it archived, or undefined for an event it had no business with. The verdict rather
// than a bare boolean, because the caller needs the evidence ID out of the same payload and
// re-parsing it there would mean two independent notions of whether an event can be read.
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

// Runs until the stream ends, which happens when the caller closes it. Applying an event twice
// writes the same values, so redelivery after a restart is harmless.
//
// A failed write stops the whole loop. Carrying on would checkpoint the *next* event, and the
// checkpoint is a single cursor: moving it past a verdict that was never archived loses that
// verdict permanently, with the regulator's archive quietly disagreeing with the ledger and
// nothing ever retrying. Stopping leaves the cursor on the last event that really was archived,
// so restarting the backend replays from exactly there.
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

    // Only after the write succeeded. Checkpointing first would have the same effect as carrying
    // on after a failure.
    await dependencies.checkpoint?.(event);
  }
}

/**
 * Deliberately outside the rule above.
 *
 * A failed archive write stops the stream, because the checkpoint is a single cursor and moving it
 * past an unarchived verdict loses that verdict forever. Neither thing is true here. The verdict is
 * already safely archived by the time this runs, and a signature result is a *finding* about the
 * evidence rather than a gap in the archive.
 *
 * So nothing here may throw. A forged reading must not halt the archiving of every later verdict,
 * and the oracle being unreachable must not take the regulator's archive down with it. Both are
 * recorded and the stream carries on: FAILED for something we checked and did not like, UNKNOWN for
 * something we could not check at all.
 */
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
    // The column already defaults to UNKNOWN, so the row still says the check has not landed and a
    // later look can settle it. Losing the whole archive over this would be the worse trade.
    console.error(`Could not record the signature check for ${evidenceId}.`, error);
  }
}

// Every field the archive stores is required and checked here. A payload that reached the insert
// missing one would fail a NOT NULL constraint, and that throw would leave the event
// uncheckpointed, so the same broken event would be retried on every restart forever.
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
