/**
 * The composite keys both contracts store records under. Kept in one place so a reader and a
 * writer can never disagree about where a record lives.
 */
import type { Context } from "fabric-contract-api";

const BATCH_KEY_PREFIX = "batch";
const TEMPERATURE_EVIDENCE_KEY_PREFIX = "temperatureEvidence";

export function batchKey(ctx: Context, batchId: string): string {
  return ctx.stub.createCompositeKey(BATCH_KEY_PREFIX, [batchId]);
}

export function temperatureEvidenceKey(ctx: Context, evidenceId: string): string {
  return ctx.stub.createCompositeKey(TEMPERATURE_EVIDENCE_KEY_PREFIX, [evidenceId]);
}
