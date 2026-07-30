import type { Context } from "fabric-contract-api";

export const BATCH_KEY_PREFIX = "batch";
export const TEMPERATURE_EVIDENCE_KEY_PREFIX = "temperatureEvidence";

export function batchKey(ctx: Context, batchId: string): string {
  return ctx.stub.createCompositeKey(BATCH_KEY_PREFIX, [batchId]);
}

export function temperatureEvidenceKey(ctx: Context, evidenceId: string): string {
  return ctx.stub.createCompositeKey(TEMPERATURE_EVIDENCE_KEY_PREFIX, [evidenceId]);
}
