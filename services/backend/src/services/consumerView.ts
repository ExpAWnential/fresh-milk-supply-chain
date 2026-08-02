/**
 * Reduces a full ledger batch record to what a shopper is allowed to see.
 *
 * Everything naming who did what, and every transaction ID, is dropped here rather than at the
 * route, so there is one place to check that nothing commercially sensitive escapes.
 */
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
// checked rather than only the current status. While a hold is open no lifecycle step will run,
// so the only ways out are a regulator clearing it, which restores whichever status the breach
// interrupted, or a recall. Anything after the breach that is neither of those two statuses is
// therefore a resolution. Treating a recall as one would tell a shopper the problem was dealt
// with when the batch was in fact withdrawn.
function coldChainStatus(status: string, history: readonly LedgerHistoryEntry[]): string {
  if (status === "COLD_CHAIN_BREACH") {
    return "UNDER_INVESTIGATION";
  }

  // History arrives newest first, so the most recent breach is the earliest match and anything
  // that happened after it sits in front of it.
  const latestBreach = history.findIndex((entry) => entry.batch?.status === "COLD_CHAIN_BREACH");
  if (latestBreach === -1) {
    return "MAINTAINED";
  }

  const clearedAfterBreach = history
    .slice(0, latestBreach)
    .some(
      (entry) =>
        entry.batch?.status !== undefined &&
        entry.batch.status !== "COLD_CHAIN_BREACH" &&
        entry.batch.status !== "RECALLED"
    );
  return clearedAfterBreach ? "BREACH_RESOLVED" : "UNRESOLVED_BREACH";
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
