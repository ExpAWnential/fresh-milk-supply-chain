// Value import, not "import type": @Transaction identifies the ctx parameter by comparing its
// emitted runtime type against Context, so an erased type import makes Fabric expect an extra
// argument on every transaction.
import { Context, Contract, Info, Returns, Transaction } from "fabric-contract-api";
import {
  BATCH_STATUSES,
  type Batch,
  type BatchHistoryEntry,
  type BatchStatus
} from "../models/Batch.js";
import { batchKey } from "../utils/ledgerKeys.js";
import {
  assertActiveRole,
  getInvokingStakeholder,
  type StakeholderRole,
  type StakeholderSummary
} from "../utils/stakeholderClient.js";
import { getTransactionMetadata } from "../utils/txContext.js";

interface HistoryTimestamp {
  readonly seconds: number | string | { toString(): string };
  readonly nanos: number;
}

// One transaction per lifecycle step rather than a single generic advance, so each step
// carries its own role rule and can be tested in isolation.
@Info({
  title: "BatchLifecycleContract",
  description: "Creates milk batches and validates lifecycle transitions."
})
export class BatchLifecycleContract extends Contract {
  @Transaction()
  public async createBatch(
    ctx: Context,
    batchId: string,
    origin: string,
    location: string
  ): Promise<void> {
    const stakeholder = await assertActiveRole(ctx, ["FARM", "PROCESSOR"]);
    const normalisedBatchId = requireValue(batchId, "Batch ID");
    const normalisedOrigin = requireValue(origin, "Origin");
    const normalisedLocation = requireValue(location, "Location");
    const key = batchKey(ctx, normalisedBatchId);
    if ((await ctx.stub.getState(key)).length > 0) {
      throw new Error(`Batch '${normalisedBatchId}' already exists.`);
    }

    const metadata = getTransactionMetadata(ctx);
    const batch: Batch = {
      batchId: normalisedBatchId,
      status: "CREATED",
      origin: normalisedOrigin,
      lastKnownLocation: normalisedLocation,
      createdByStakeholderId: stakeholder.stakeholderId,
      createdTxId: metadata.txId,
      createdAt: metadata.timestamp,
      lastUpdatedByStakeholderId: stakeholder.stakeholderId,
      lastUpdatedTxId: metadata.txId,
      lastUpdatedAt: metadata.timestamp
    };

    await putBatch(ctx, batch);
    emitLifecycleEvent(ctx, "BatchCreated", batch, stakeholder);
  }

  @Transaction()
  public async recordProcessingEvent(
    ctx: Context,
    batchId: string,
    location: string
  ): Promise<void> {
    await this.transitionBatch(
      ctx,
      batchId,
      location,
      ["PROCESSOR"],
      "CREATED",
      "PROCESSED",
      "BatchProcessed"
    );
  }

  @Transaction()
  public async startTransport(ctx: Context, batchId: string, location: string): Promise<void> {
    await this.transitionBatch(
      ctx,
      batchId,
      location,
      ["LOGISTICS"],
      "PROCESSED",
      "IN_TRANSIT",
      "BatchTransportStarted"
    );
  }

  @Transaction()
  public async recordDelivery(ctx: Context, batchId: string, location: string): Promise<void> {
    await this.transitionBatch(
      ctx,
      batchId,
      location,
      ["RETAILER"],
      "IN_TRANSIT",
      "DELIVERED",
      "BatchDelivered"
    );
  }

  @Transaction()
  public async recallBatch(ctx: Context, batchId: string, reason: string): Promise<void> {
    const regulator = await assertActiveRole(ctx, ["REGULATOR"]);
    const normalisedBatchId = requireValue(batchId, "Batch ID");
    const normalisedReason = requireValue(reason, "Recall reason");
    const batch = await getBatchRecord(ctx, normalisedBatchId);
    if (batch.status === "RECALLED") {
      throw new Error(`Batch '${normalisedBatchId}' is already recalled.`);
    }

    const metadata = getTransactionMetadata(ctx);
    const recalledBatch: Batch = {
      ...batch,
      status: "RECALLED",
      lastUpdatedByStakeholderId: regulator.stakeholderId,
      lastUpdatedTxId: metadata.txId,
      lastUpdatedAt: metadata.timestamp,
      recallReason: normalisedReason,
      recalledByStakeholderId: regulator.stakeholderId,
      recalledTxId: metadata.txId,
      recalledAt: metadata.timestamp
    };

    await putBatch(ctx, recalledBatch);
    emitLifecycleEvent(ctx, "BatchRecalled", recalledBatch, regulator, {
      reason: normalisedReason,
      previousStatus: batch.status
    });
  }

  @Transaction(false)
  @Returns("string")
  public async getBatch(ctx: Context, batchId: string): Promise<string> {
    await getInvokingStakeholder(ctx);
    return JSON.stringify(await getBatchRecord(ctx, requireValue(batchId, "Batch ID")));
  }

  @Transaction(false)
  @Returns("string")
  public async getBatchHistory(ctx: Context, batchId: string): Promise<string> {
    await getInvokingStakeholder(ctx);
    const normalisedBatchId = requireValue(batchId, "Batch ID");
    await getBatchRecord(ctx, normalisedBatchId);

    const iterator = await ctx.stub.getHistoryForKey(batchKey(ctx, normalisedBatchId));
    const history: BatchHistoryEntry[] = [];
    try {
      while (true) {
        const result = await iterator.next();
        if (result.done) {
          break;
        }
        if (!result.value) {
          continue;
        }

        const isDelete = result.value.isDelete;
        const batch = isDelete ? null : parseBatch(result.value.value, normalisedBatchId);
        history.push({
          txId: result.value.txId,
          timestamp: fabricTimestampToIso(result.value.timestamp as HistoryTimestamp),
          isDelete,
          submittedByStakeholderId: batch?.lastUpdatedByStakeholderId ?? null,
          batch
        });
      }
    } finally {
      await iterator.close();
    }

    return JSON.stringify(history);
  }

  @Transaction(false)
  @Returns("string")
  public async queryBatchesByStatus(ctx: Context, status: string): Promise<string> {
    await getInvokingStakeholder(ctx);
    const normalisedStatus = requireValue(status, "Batch status").toUpperCase();
    if (!isBatchStatus(normalisedStatus)) {
      throw new Error(
        `Invalid batch status '${normalisedStatus}'. Expected one of: ${BATCH_STATUSES.join(", ")}.`
      );
    }

    const iterator = await ctx.stub.getQueryResult(
      JSON.stringify({
        selector: {
          status: normalisedStatus
        }
      })
    );
    const batches: Batch[] = [];
    try {
      while (true) {
        const result = await iterator.next();
        if (result.done) {
          break;
        }
        if (result.value?.value) {
          batches.push(parseBatch(result.value.value));
        }
      }
    } finally {
      await iterator.close();
    }

    batches.sort((left, right) => left.batchId.localeCompare(right.batchId));
    return JSON.stringify(batches);
  }

  private async transitionBatch(
    ctx: Context,
    batchId: string,
    location: string,
    allowedRoles: readonly StakeholderRole[],
    expectedStatus: BatchStatus,
    nextStatus: BatchStatus,
    eventName: string
  ): Promise<void> {
    const stakeholder = await assertActiveRole(ctx, allowedRoles);
    const normalisedBatchId = requireValue(batchId, "Batch ID");
    const normalisedLocation = requireValue(location, "Location");
    const batch = await getBatchRecord(ctx, normalisedBatchId);
    if (batch.status !== expectedStatus) {
      throw new Error(
        `Batch '${normalisedBatchId}' cannot move from '${batch.status}' to '${nextStatus}'; ` +
          `expected current status '${expectedStatus}'.`
      );
    }

    const metadata = getTransactionMetadata(ctx);
    const updatedBatch: Batch = {
      ...batch,
      status: nextStatus,
      lastKnownLocation: normalisedLocation,
      lastUpdatedByStakeholderId: stakeholder.stakeholderId,
      lastUpdatedTxId: metadata.txId,
      lastUpdatedAt: metadata.timestamp
    };

    await putBatch(ctx, updatedBatch);
    emitLifecycleEvent(ctx, eventName, updatedBatch, stakeholder, {
      previousStatus: batch.status
    });
  }
}

function requireValue(value: string, fieldName: string): string {
  const normalised = value.trim();
  if (!normalised) {
    throw new Error(`${fieldName} must not be empty.`);
  }
  return normalised;
}

function isBatchStatus(value: string): value is BatchStatus {
  return BATCH_STATUSES.includes(value as BatchStatus);
}

async function getBatchRecord(ctx: Context, batchId: string): Promise<Batch> {
  const value = await ctx.stub.getState(batchKey(ctx, batchId));
  if (value.length === 0) {
    throw new Error(`Batch '${batchId}' does not exist.`);
  }
  return parseBatch(value, batchId);
}

function parseBatch(value: Uint8Array, expectedBatchId?: string): Batch {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value).toString());
  } catch {
    throw new Error(
      expectedBatchId
        ? `Batch '${expectedBatchId}' contains invalid ledger data.`
        : "A batch query returned invalid ledger data."
    );
  }

  if (!isBatch(parsed) || (expectedBatchId && parsed.batchId !== expectedBatchId)) {
    throw new Error(
      expectedBatchId
        ? `Batch '${expectedBatchId}' contains invalid ledger data.`
        : "A batch query returned invalid ledger data."
    );
  }
  return parsed;
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

async function putBatch(ctx: Context, batch: Batch): Promise<void> {
  await ctx.stub.putState(batchKey(ctx, batch.batchId), Buffer.from(JSON.stringify(batch)));
}

function emitLifecycleEvent(
  ctx: Context,
  eventName: string,
  batch: Batch,
  stakeholder: StakeholderSummary,
  details: Readonly<Record<string, unknown>> = {}
): void {
  ctx.stub.setEvent(
    eventName,
    Buffer.from(
      JSON.stringify({
        batchId: batch.batchId,
        status: batch.status,
        stakeholderId: stakeholder.stakeholderId,
        txId: batch.lastUpdatedTxId,
        timestamp: batch.lastUpdatedAt,
        ...details
      })
    )
  );
}

function fabricTimestampToIso(timestamp: HistoryTimestamp | null | undefined): string {
  if (!timestamp) {
    throw new Error("Fabric history returned a record without a timestamp.");
  }
  const seconds = Number(timestamp.seconds.toString());
  const nanos = timestamp.nanos;
  if (!Number.isSafeInteger(seconds) || !Number.isInteger(nanos)) {
    throw new Error("Fabric history returned an invalid timestamp.");
  }

  const date = new Date(seconds * 1_000 + Math.floor(nanos / 1_000_000));
  if (Number.isNaN(date.getTime())) {
    throw new Error("Fabric history returned an invalid timestamp.");
  }
  return date.toISOString();
}
