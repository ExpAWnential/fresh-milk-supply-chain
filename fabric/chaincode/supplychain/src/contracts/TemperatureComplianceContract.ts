/**
 * Anchors the oracle's temperature evidence and decides whether the cold chain held.
 *
 * The verdict is derived here from the submitted statistics and never taken from the oracle, so a
 * compromised oracle cannot declare unsafe milk safe. Unsafe evidence puts the batch on hold, and
 * only a regulator can clear it.
 */

// Value import, not "import type": @Transaction identifies the ctx parameter by comparing its
// emitted runtime type against Context, so an erased type import makes Fabric expect an extra
// argument on every transaction.
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
  // The oracle submits statistics computed off-chain, but the compliance result is always
  // derived again by this contract. Raw sensor readings remain in PostgreSQL.
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

    // Milk has to stay cold from the farm's bulk tank to the retailer's fridge, not only in the
    // truck, so evidence is accepted at every stage. A recalled batch is the exception: it has
    // been withdrawn, and there is nothing left for a cold-chain verdict to protect.
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
        // Only the first breach records where the batch came from. A second unsafe reading while
        // the hold is already open must not overwrite it with COLD_CHAIN_BREACH itself.
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

    // Clearing the hold puts the batch back where the breach found it, so a breach in the farm's
    // tank does not send the batch forward past processing. The IN_TRANSIT fallback covers records
    // written before the batch carried this field. The original unsafe evidence stays on the
    // ledger either way.
    const metadata = getTransactionMetadata(ctx);
    const resolvedBatch: Batch = {
      ...batch,
      status: batch.statusBeforeBreach ?? "IN_TRANSIT",
      // The hold is closed, so what it interrupted is no longer pending. JSON.stringify drops it.
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
  const averageCelsius = requireFiniteNumber(candidate.averageCelsius, "averageCelsius");
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
  if (averageCelsius < minCelsius || averageCelsius > maxCelsius) {
    throw new Error(
      "Temperature statistic 'averageCelsius' must be between 'minCelsius' and 'maxCelsius'."
    );
  }

  return {
    minCelsius,
    maxCelsius,
    averageCelsius,
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

