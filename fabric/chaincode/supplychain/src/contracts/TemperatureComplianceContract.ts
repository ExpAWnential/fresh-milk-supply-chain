// Value import, not "import type": @Transaction identifies the ctx parameter by comparing its
// emitted runtime type against Context, so an erased type import makes Fabric expect an extra
// argument on every transaction.
import { Context, Contract, Info, Returns, Transaction } from "fabric-contract-api";
import type { Batch } from "../models/Batch.js";
import type {
  TemperatureEvidence,
  TemperatureStatistics
} from "../models/TemperatureEvidence.js";
import { batchKey, temperatureEvidenceKey } from "../utils/ledgerKeys.js";
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

    const batch = await getBatchRecord(ctx, normalisedBatchId);
    if (batch.status !== "IN_TRANSIT") {
      throw new Error(
        `Batch '${normalisedBatchId}' must be IN_TRANSIT before temperature evidence can be submitted; ` +
          `current status is '${batch.status}'.`
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
        lastUpdatedByStakeholderId: oracle.stakeholderId,
        lastUpdatedTxId: metadata.txId,
        lastUpdatedAt: metadata.timestamp
      };
      await ctx.stub.putState(
        batchKey(ctx, normalisedBatchId),
        Buffer.from(JSON.stringify(breachedBatch))
      );

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

    // A breach occurs during transport, so clearing the hold returns the batch to IN_TRANSIT.
    // The original unsafe evidence remains immutable on the ledger.
    const metadata = getTransactionMetadata(ctx);
    const resolvedBatch: Batch = {
      ...batch,
      status: "IN_TRANSIT",
      lastUpdatedByStakeholderId: regulator.stakeholderId,
      lastUpdatedTxId: metadata.txId,
      lastUpdatedAt: metadata.timestamp
    };

    await ctx.stub.putState(
      batchKey(ctx, normalisedBatchId),
      Buffer.from(JSON.stringify(resolvedBatch))
    );
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

  @Transaction(false)
  @Returns("boolean")
  public async verifyEvidenceReference(
    ctx: Context,
    evidenceId: string,
    evidenceHash: string
  ): Promise<boolean> {
    const anchoredEvidence = JSON.parse(
      await this.getTemperatureEvidence(ctx, evidenceId)
    ) as TemperatureEvidence;
    const recomputedHash = parseSha256Hash(evidenceHash);
    return anchoredEvidence.evidenceHash === recomputedHash;
  }
}

function requireValue(value: string, fieldName: string): string {
  const normalised = value.trim();
  if (!normalised) {
    throw new Error(`${fieldName} must not be empty.`);
  }
  return normalised;
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

async function getBatchRecord(ctx: Context, batchId: string): Promise<Batch> {
  const value = await ctx.stub.getState(batchKey(ctx, batchId));
  if (value.length === 0) {
    throw new Error(`Batch '${batchId}' does not exist.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value.toString());
  } catch {
    throw new Error(`Batch '${batchId}' contains invalid ledger data.`);
  }

  if (!isBatch(parsed) || parsed.batchId !== batchId) {
    throw new Error(`Batch '${batchId}' contains invalid ledger data.`);
  }
  return parsed;
}

function isBatch(value: unknown): value is Batch {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<Batch>;
  const validStatuses = new Set([
    "CREATED",
    "PROCESSED",
    "IN_TRANSIT",
    "DELIVERED",
    "RECALLED",
    "COLD_CHAIN_BREACH"
  ]);

  return (
    typeof candidate.batchId === "string" &&
    candidate.batchId.length > 0 &&
    typeof candidate.status === "string" &&
    validStatuses.has(candidate.status) &&
    typeof candidate.createdByStakeholderId === "string" &&
    typeof candidate.createdTxId === "string" &&
    typeof candidate.createdAt === "string"
  );
}
