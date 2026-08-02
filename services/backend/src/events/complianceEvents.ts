/**
 * Applies the ledger's own compliance events to the off-chain database.
 *
 * This is how the PostgreSQL copy of a verdict comes from what the contract decided, rather than
 * from what the oracle expected it to decide.
 */
import type { ComplianceOutcome, TemperatureRepository } from "@fresh-milk/storage";

// The shape this consumer needs from a chaincode event, so it can be exercised without a network.
export interface LedgerEvent {
  readonly eventName: string;
  readonly payload: Uint8Array;
}

// Parameterised by the event type so the checkpoint callback receives whatever the stream yields,
// rather than the narrower shape this module reads.
export interface ComplianceEventDependencies<TEvent extends LedgerEvent = LedgerEvent> {
  readonly temperatureRepository: TemperatureRepository;
  // Records that an event has been dealt with, so a restart resumes after it instead of at the
  // start of the chain. Omitted where resuming does not matter.
  readonly checkpoint?: (event: TEvent) => Promise<void>;
}

// The contract announces its verdict under a different name depending on which way it went, and
// both have to be applied. Listening only to the safe one would leave the off-chain copy of a
// breach holding whatever the oracle guessed, which is the reading that matters most.
const VERDICT_EVENTS: ReadonlySet<string> = new Set([
  "TemperatureEvidenceSubmitted",
  "ColdChainBreach"
]);

interface VerdictPayload {
  readonly evidenceId: string;
  readonly complianceOutcome: ComplianceOutcome;
  readonly txId: string;
}

// The oracle writes its own reading of the temperature range when it saves the evidence, but the
// contract re-derives the verdict on chain and that is the one that counts. Listening for the
// event is how the off-chain copy learns what the ledger actually decided, rather than keeping a
// second opinion that happens to agree.
export async function applyComplianceEvent(
  event: LedgerEvent,
  temperatureRepository: TemperatureRepository
): Promise<boolean> {
  if (!VERDICT_EVENTS.has(event.eventName)) {
    return false;
  }

  const payload = parsePayload(event.payload);
  if (!payload) {
    // A malformed event is not worth stopping the stream for, and there is nothing to apply.
    console.error(`Ignored a ${event.eventName} event that could not be read.`);
    return false;
  }

  return temperatureRepository.recordLedgerOutcome(
    payload.evidenceId,
    payload.complianceOutcome,
    payload.txId
  );
}

// Runs until the stream ends, which happens when the caller closes it. Applying an event twice
// writes the same values, so redelivery after a restart is harmless.
export async function consumeComplianceEvents<TEvent extends LedgerEvent>(
  events: AsyncIterable<TEvent>,
  dependencies: ComplianceEventDependencies<TEvent>
): Promise<void> {
  for await (const event of events) {
    try {
      await applyComplianceEvent(event, dependencies.temperatureRepository);
      await dependencies.checkpoint?.(event);
    } catch (error) {
      // One failed update must not take the listener down with it, and the event is deliberately
      // left uncheckpointed so the next run sees it again. Applying it twice writes the same
      // values, so that retry costs nothing.
      console.error(`Failed to apply a ${event.eventName} event.`, error);
    }
  }
}

function parsePayload(payload: Uint8Array): VerdictPayload | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload).toString());
  } catch {
    return undefined;
  }

  const candidate = parsed as Partial<VerdictPayload>;
  const outcomeIsKnown =
    candidate.complianceOutcome === "COMPLIANT" || candidate.complianceOutcome === "UNSAFE";

  return typeof candidate.evidenceId === "string" &&
    candidate.evidenceId.length > 0 &&
    typeof candidate.txId === "string" &&
    candidate.txId.length > 0 &&
    outcomeIsKnown
    ? (candidate as VerdictPayload)
    : undefined;
}
