/**
 * Turns the detailed ledger record into the simple provenance view shown to a shopper.
 *
 * The view keeps locations, lifecycle stages and cold-chain warnings, while intentionally omitting
 * consortium identities and transaction metadata that are useful to auditors rather than consumers.
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

// History reveals cleared breaches that the current status alone would hide. A recall withdraws
// the batch and does not count as resolving its breach.
function coldChainStatus(status: string, history: readonly LedgerHistoryEntry[]): string {
  if (status === "COLD_CHAIN_BREACH") {
    return "UNDER_INVESTIGATION";
  }

  // History is newest first, so entries before the breach occurred after it.
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

// Walk oldest to newest and show only the first occurrence of each journey stage.
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

/** Builds the public traceability response from current ledger state and its complete history. */
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
