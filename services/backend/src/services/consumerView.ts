export interface LedgerBatch {
  readonly batchId: string;
  readonly status: string;
  readonly origin?: string;
  readonly lastKnownLocation?: string;
  readonly createdAt: string;
  readonly recallReason?: string;
}

export interface LedgerHistoryEntry {
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
// intermediate corrections. History arrives newest first, so it is walked backwards.
function milestones(history: readonly LedgerHistoryEntry[]): Record<string, string> {
  const reached: Record<string, string> = {};
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const status = history[index].batch?.status;
    if (status && !reached[status]) {
      reached[status] = history[index].timestamp;
    }
  }
  return reached;
}

// What a consumer is allowed to see. Everything else the ledger holds, in particular which
// stakeholder recorded each step and the transaction IDs, stays out of the response.
export function consumerView(
  batch: LedgerBatch,
  history: readonly LedgerHistoryEntry[]
): Record<string, unknown> {
  return {
    batchId: batch.batchId,
    // Batches created before origin and location were recorded are still readable.
    origin: batch.origin ?? "not recorded",
    lastKnownLocation: batch.lastKnownLocation ?? "not recorded",
    status: batch.status,
    coldChain: coldChainStatus(batch.status, history),
    createdAt: batch.createdAt,
    milestones: milestones(history),
    ...(batch.status === "RECALLED" ? { recallReason: batch.recallReason } : {})
  };
}
