/**
 * Records the journey of a milk batch from creation through processing, transport and delivery.
 *
 * Each transition is a separate Fabric transaction with its own role check. The ledger therefore
 * records both the current state and the complete history needed for traceability.
 */

// Fabric's decorators inspect Context at runtime, so it must remain a value import.
import { Context, Contract, Info, Returns, Transaction } from "fabric-contract-api";
import { BATCH_STATUSES, type Batch, type BatchHistoryEntry, type BatchStatus } from "../models/Batch.js";
import { batchKey } from "../utils/ledgerKeys.js";
import {
  getBatchRecord,
  isBatchStatus,
  parseBatch,
  putBatch,
  requireValue
} from "../utils/batchStore.js";
import {
  assertActiveRole,
  getInvokingStakeholder,
  type StakeholderRole,
  type StakeholderSummary
} from "../utils/stakeholderClient.js";
import { getTransactionMetadata } from "../utils/txContext.js";

interface HistoryTimestamp {
  readonly seconds: { toString(): string };
  readonly nanos: number;
}

interface HistoryEntry {
  readonly txId: string;
  readonly timestamp: HistoryTimestamp;
  readonly isDelete: boolean;
  readonly value: Uint8Array;
}

// Fabric iterators must be consumed and closed explicitly.
async function drain<TEntry, TResult>(
  iterator: { next(): Promise<{ done?: boolean; value?: TEntry }>; close(): Promise<void> },
  take: (entry: TEntry) => TResult | undefined
): Promise<TResult[]> {
  const collected: TResult[] = [];
  try {
    for (;;) {
      const result = await iterator.next();
      if (result.done) {
        break;
      }
      const mapped = result.value === undefined ? undefined : take(result.value);
      if (mapped !== undefined) {
        collected.push(mapped);
      }
    }
  } finally {
    await iterator.close();
  }
  return collected;
}

@Info({
  title: "BatchLifecycleContract",
  description: "Creates milk batches and validates lifecycle transitions."
})
export class BatchLifecycleContract extends Contract {
  /** Creates the immutable provenance record that begins a batch's ledger history. */
  @Transaction()
  public async createBatch(
    ctx: Context,
    batchId: string,
    origin: string,
    location: string
  ): Promise<void> {
    const stakeholder = await assertActiveRole(ctx, ["FARM"]);
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

  /** Records the processor's custody step and current batch location. */
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

  /** Moves a processed batch into transport under the logistics identity. */
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

  /** Records retailer delivery as the final normal lifecycle transition. */
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

  /** Permanently withdraws a batch while retaining the state and provenance that led to the recall. */
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

  /** Returns the current ledger state for a batch after checking consortium membership. */
  @Transaction(false)
  @Returns("string")
  public async getBatch(ctx: Context, batchId: string): Promise<string> {
    await getInvokingStakeholder(ctx);
    return JSON.stringify(await getBatchRecord(ctx, requireValue(batchId, "Batch ID")));
  }

  /** Returns the complete Fabric history so cleared breaches remain visible after status changes. */
  @Transaction(false)
  @Returns("string")
  public async getBatchHistory(ctx: Context, batchId: string): Promise<string> {
    await getInvokingStakeholder(ctx);
    const normalisedBatchId = requireValue(batchId, "Batch ID");
    await getBatchRecord(ctx, normalisedBatchId);

    const history = await drain<HistoryEntry, BatchHistoryEntry>(
      await ctx.stub.getHistoryForKey(batchKey(ctx, normalisedBatchId)),
      (entry) => {
        const isDelete = entry.isDelete;
        const batch = isDelete ? null : parseBatch(entry.value, normalisedBatchId);
        return {
          txId: entry.txId,
          timestamp: fabricTimestampToIso(entry.timestamp),
          isDelete,
          submittedByStakeholderId: batch?.lastUpdatedByStakeholderId ?? null,
          batch
        };
      }
    );

    return JSON.stringify(history);
  }

  /** Uses a CouchDB rich query to find batches in one lifecycle state. */
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

    const batches = await drain(
      await ctx.stub.getQueryResult(JSON.stringify({ selector: { status: normalisedStatus } })),
      (entry) => (entry.value ? parseBatch(entry.value) : undefined)
    );

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
