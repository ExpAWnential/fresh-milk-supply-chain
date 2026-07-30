import { Router } from "express";
import { config } from "../config.js";
import { getDemoIdentity } from "../demoIdentity.js";
import { createFabricGatewayClient } from "../fabric/gateway.js";
import { sendGatewayError } from "../fabric/request.js";

const CONTRACT = "BatchLifecycleContract";

// Consumers are not members of the Fabric network. They read a filtered view of a batch
// through this endpoint instead of holding a blockchain identity, so the request carries no
// identity header and the backend reads the ledger on their behalf.
export const publicRouter = Router();

interface LedgerBatch {
  readonly batchId: string;
  readonly status: string;
  readonly origin?: string;
  readonly createdAt: string;
  readonly recallReason?: string;
}

interface LedgerHistoryEntry {
  readonly timestamp: string;
  readonly batch: { readonly status?: string } | null;
}

// A breach that a regulator has since cleared still matters to a shopper, so the history is
// checked rather than only the current status.
function coldChainStatus(status: string, history: readonly LedgerHistoryEntry[]): string {
  if (status === "COLD_CHAIN_BREACH") {
    return "UNDER_INVESTIGATION";
  }
  const everBreached = history.some((entry) => entry.batch?.status === "COLD_CHAIN_BREACH");
  return everBreached ? "BREACH_RESOLVED" : "MAINTAINED";
}

// Only the first time the batch reached each status, so a consumer sees the journey without the
// intermediate corrections.
function milestones(history: readonly LedgerHistoryEntry[]): Record<string, string> {
  const reached: Record<string, string> = {};
  for (const entry of [...history].reverse()) {
    const status = entry.batch?.status;
    if (status && !reached[status]) {
      reached[status] = entry.timestamp;
    }
  }
  return reached;
}

publicRouter.get("/batches/:batchId", async (req, res) => {
  // Reads are made as the regulator because a consumer holds no network identity. Only the
  // fields below are returned, so the caller never sees who submitted what.
  const client = await createFabricGatewayClient(getDemoIdentity("regulator"));
  try {
    const read = async (transaction: string): Promise<unknown> =>
      JSON.parse(
        Buffer.from(
          await client.evaluateTransaction(
            config.supplychainChaincodeName,
            CONTRACT,
            transaction,
            req.params.batchId
          )
        ).toString()
      );

    const batch = (await read("getBatch")) as LedgerBatch;
    const history = (await read("getBatchHistory")) as readonly LedgerHistoryEntry[];

    res.json({
      batchId: batch.batchId,
      origin: batch.origin ?? "not recorded",
      status: batch.status,
      coldChain: coldChainStatus(batch.status, history),
      createdAt: batch.createdAt,
      milestones: milestones(history),
      ...(batch.status === "RECALLED" ? { recallReason: batch.recallReason } : {})
    });
  } catch (error) {
    sendGatewayError(res, error);
  } finally {
    client.close();
  }
});
