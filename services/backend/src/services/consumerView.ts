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
// checked rather than only the current status. A breach only counts as cleared when the batch
// returned to IN_TRANSIT afterwards, which is the one status resolveTemperatureBreach produces.
// Leaving a breach behind any other way, such as recalling the batch while the hold is open,
// leaves it unresolved, and saying otherwise would tell a shopper the problem was dealt with.
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
    .some((entry) => entry.batch?.status === "IN_TRANSIT");
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
