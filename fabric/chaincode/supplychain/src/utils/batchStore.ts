/** Shares batch parsing and persistence rules between the lifecycle and compliance contracts. */
import type { Context } from "fabric-contract-api";
import { BATCH_STATUSES, type Batch, type BatchStatus } from "../models/Batch.js";
import { batchKey } from "./ledgerKeys.js";

export function requireValue(value: string, fieldName: string): string {
  const normalised = value.trim();
  if (!normalised) {
    throw new Error(`${fieldName} must not be empty.`);
  }
  return normalised;
}

export function isBatchStatus(value: string): value is BatchStatus {
  return (BATCH_STATUSES as readonly string[]).includes(value);
}

export function parseBatch(value: Uint8Array, expectedBatchId?: string): Batch {
  const invalid = new Error(
    `Batch '${expectedBatchId ?? "record"}' contains invalid ledger data.`
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value).toString());
  } catch {
    throw invalid;
  }

  if (!isBatch(parsed) || (expectedBatchId !== undefined && parsed.batchId !== expectedBatchId)) {
    throw invalid;
  }
  return parsed;
}

export async function getBatchRecord(ctx: Context, batchId: string): Promise<Batch> {
  const value = await ctx.stub.getState(batchKey(ctx, batchId));
  if (value.length === 0) {
    throw new Error(`Batch '${batchId}' does not exist.`);
  }
  return parseBatch(value, batchId);
}

export async function putBatch(ctx: Context, batch: Batch): Promise<void> {
  await ctx.stub.putState(batchKey(ctx, batch.batchId), Buffer.from(JSON.stringify(batch)));
}

function isBatch(value: unknown): value is Batch {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<Batch>;
  return (
    typeof candidate.batchId === "string" &&
    candidate.batchId.length > 0 &&
    typeof candidate.status === "string" &&
    isBatchStatus(candidate.status) &&
    typeof candidate.createdByStakeholderId === "string" &&
    typeof candidate.createdTxId === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.lastUpdatedByStakeholderId === "string" &&
    typeof candidate.lastUpdatedTxId === "string" &&
    typeof candidate.lastUpdatedAt === "string"
  );
}
