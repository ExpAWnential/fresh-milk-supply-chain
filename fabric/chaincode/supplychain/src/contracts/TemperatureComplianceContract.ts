/**
 * Anchors a summary of off-chain temperature readings and applies the cold-chain rules on Fabric.
 *
 * The oracle supplies the hash and statistics, but it does not get to choose the verdict. This
 * contract derives compliance itself and places the batch on hold when the recorded range is unsafe.
 */

// Fabric's decorators inspect Context at runtime, so it must remain a value import.
import { Context, Contract, Info, Returns, Transaction } from "fabric-contract-api";
import type { Batch } from "../models/Batch.js";
import type {
  TemperatureEvidence,
  TemperatureStatistics
} from "../models/TemperatureEvidence.js";
import { temperatureEvidenceKey } from "../utils/ledgerKeys.js";
import { getBatchRecord, putBatch, requireValue } from "../utils/batchStore.js";
import { assertActiveRole, getInvokingStakeholder } from "../utils/stakeholderClient.js";
import { getTransactionMetadata } from "../utils/txContext.js";

const MIN_SAFE_CELSIUS = 0;
const MAX_SAFE_CELSIUS = 5;

@Info({
  title: "TemperatureComplianceContract",
  description: "Anchors hashed temperature evidence and decides cold-chain compliance."
})
export class TemperatureComplianceContract extends Contract {
  /**
   * Stores the evidence anchor and derives the verdict from its statistics.
   * Unsafe evidence also records the interrupted batch stage before placing the batch on hold.
   */
  @Transaction()
  public async submitTemperatureEvidence(
    ctx: Context,
    evidenceId: string,
    batchId: string,
    evidenceHash: string,
    offChainReference: string,
    statisticsJson: string
  ): Promise<void> {
    const oracle = await assertActiveRole(ctx, ["ORACLE"]);
    const normalisedEvidenceId = requireValue(evidenceId, "Evidence ID");
    const normalisedBatchId = requireValue(batchId, "Batch ID");
    const normalisedHash = parseSha256Hash(evidenceHash);
    const normalisedReference = requireValue(offChainReference, "Off-chain reference");
    const statistics = parseStatistics(statisticsJson);

    const evidenceLedgerKey = temperatureEvidenceKey(ctx, normalisedEvidenceId);
    if ((await ctx.stub.getState(evidenceLedgerKey)).length > 0) {
      throw new Error(`Temperature evidence '${normalisedEvidenceId}' already exists.`);
    }

    // Cold-chain monitoring covers every active stage, but recalled batches are already withdrawn.
    const batch = await getBatchRecord(ctx, normalisedBatchId);
    if (batch.status === "RECALLED") {
      throw new Error(
        `Batch '${normalisedBatchId}' has been recalled, so temperature evidence can no longer be submitted.`
      );
    }

    const complianceOutcome = deriveComplianceOutcome(statistics);
    const metadata = getTransactionMetadata(ctx);
    const evidence: TemperatureEvidence = {
      evidenceId: normalisedEvidenceId,
      batchId: normalisedBatchId,
      evidenceHash: normalisedHash,
      offChainReference: normalisedReference,
      statistics,
      complianceOutcome,
      submittedByStakeholderId: oracle.stakeholderId,
      submittedTxId: metadata.txId,
      submittedAt: metadata.timestamp
    };

    await ctx.stub.putState(evidenceLedgerKey, Buffer.from(JSON.stringify(evidence)));

    if (complianceOutcome === "UNSAFE") {
      const breachedBatch: Batch = {
        ...batch,
        status: "COLD_CHAIN_BREACH",
        // Preserve the stage interrupted by the first unresolved breach.
        statusBeforeBreach:
          batch.status === "COLD_CHAIN_BREACH" ? batch.statusBeforeBreach : batch.status,
        lastUpdatedByStakeholderId: oracle.stakeholderId,
        lastUpdatedTxId: metadata.txId,
        lastUpdatedAt: metadata.timestamp
      };
      await putBatch(ctx, breachedBatch);

      ctx.stub.setEvent(
        "ColdChainBreach",
        Buffer.from(
          JSON.stringify({
            evidenceId: normalisedEvidenceId,
            batchId: normalisedBatchId,
            evidenceHash: normalisedHash,
            complianceOutcome,
            statistics,
            submittedByStakeholderId: oracle.stakeholderId,
            txId: metadata.txId,
            timestamp: metadata.timestamp
          })
        )
      );
      return;
    }

    ctx.stub.setEvent(
      "TemperatureEvidenceSubmitted",
      Buffer.from(
        JSON.stringify({
          evidenceId: normalisedEvidenceId,
          batchId: normalisedBatchId,
          evidenceHash: normalisedHash,
          complianceOutcome,
          submittedByStakeholderId: oracle.stakeholderId,
          txId: metadata.txId,
          timestamp: metadata.timestamp
        })
      )
    );
  }

  /** Clears an investigated breach and restores the stage that was interrupted by the hold. */
  @Transaction()
  public async resolveTemperatureBreach(
    ctx: Context,
    batchId: string,
    reason: string
  ): Promise<void> {
    const regulator = await assertActiveRole(ctx, ["REGULATOR"]);
    const normalisedBatchId = requireValue(batchId, "Batch ID");
    const normalisedReason = requireValue(reason, "Resolution reason");
    const batch = await getBatchRecord(ctx, normalisedBatchId);

    if (batch.status !== "COLD_CHAIN_BREACH") {
      throw new Error(
        `Batch '${normalisedBatchId}' does not have an unresolved cold-chain breach; ` +
          `current status is '${batch.status}'.`
      );
    }

    // Records without an interrupted stage use the only safe legacy assumption: transport.
    const metadata = getTransactionMetadata(ctx);
    const resolvedBatch: Batch = {
      ...batch,
      status: batch.statusBeforeBreach ?? "IN_TRANSIT",
      statusBeforeBreach: undefined,
      lastUpdatedByStakeholderId: regulator.stakeholderId,
      lastUpdatedTxId: metadata.txId,
      lastUpdatedAt: metadata.timestamp
    };

    await putBatch(ctx, resolvedBatch);
    ctx.stub.setEvent(
      "ColdChainBreachResolved",
      Buffer.from(
        JSON.stringify({
          batchId: normalisedBatchId,
          reason: normalisedReason,
          resolvedByStakeholderId: regulator.stakeholderId,
          txId: metadata.txId,
          timestamp: metadata.timestamp
        })
      )
    );
  }

  /** Returns one immutable evidence anchor for independent comparison with off-chain readings. */
  @Transaction(false)
  @Returns("string")
  public async getTemperatureEvidence(ctx: Context, evidenceId: string): Promise<string> {
    await getInvokingStakeholder(ctx);
    const normalisedEvidenceId = requireValue(evidenceId, "Evidence ID");
    const value = await ctx.stub.getState(temperatureEvidenceKey(ctx, normalisedEvidenceId));
    if (value.length === 0) {
      throw new Error(`Temperature evidence '${normalisedEvidenceId}' does not exist.`);
    }

    return value.toString();
  }

}

function parseSha256Hash(value: string): string {
  const normalised = requireValue(value, "Evidence hash").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalised)) {
    throw new Error("Evidence hash must be a 64-character hexadecimal SHA-256 value.");
  }
  return normalised;
}

function parseStatistics(value: string): TemperatureStatistics {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Temperature statistics must be valid JSON.");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Temperature statistics must be a JSON object.");
  }

  const candidate = parsed as Partial<TemperatureStatistics>;
  const minCelsius = requireFiniteNumber(candidate.minCelsius, "minCelsius");
  const maxCelsius = requireFiniteNumber(candidate.maxCelsius, "maxCelsius");
  const readingCount = candidate.readingCount;

  if (
    typeof readingCount !== "number" ||
    !Number.isSafeInteger(readingCount) ||
    readingCount <= 0
  ) {
    throw new Error("Temperature statistic 'readingCount' must be a positive integer.");
  }
  if (minCelsius > maxCelsius) {
    throw new Error("Temperature statistic 'minCelsius' must not exceed 'maxCelsius'.");
  }

  return {
    minCelsius,
    maxCelsius,
    readingCount
  };
}

function requireFiniteNumber(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Temperature statistic '${fieldName}' must be a finite number.`);
  }
  return value;
}

function deriveComplianceOutcome(
  statistics: TemperatureStatistics
): TemperatureEvidence["complianceOutcome"] {
  return statistics.minCelsius >= MIN_SAFE_CELSIUS &&
    statistics.maxCelsius <= MAX_SAFE_CELSIUS
    ? "COMPLIANT"
    : "UNSAFE";
}
