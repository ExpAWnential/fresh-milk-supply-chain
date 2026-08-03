/**
 * The audit stamp written onto every ledger record: which transaction, when, and signed by whom.
 *
 * All three are taken from Fabric's transaction context, so no caller can choose them.
 */
import type { Context } from "fabric-contract-api";
import { getInvokingIdentity } from "./identity.js";

export interface TransactionMetadata {
  readonly txId: string;
  readonly timestamp: string;
  readonly invokingCertificateId: string;
}

/** Builds audit metadata exclusively from Fabric's authenticated transaction context. */
export function getTransactionMetadata(ctx: Context): TransactionMetadata {
  const timestamp = ctx.stub.getTxTimestamp();
  // Fabric reports the time as whole seconds plus nanoseconds, and a malformed value would end up
  // written into ledger records that are supposed to be an audit trail.
  const seconds = Number(timestamp.seconds.toString());
  const nanos = timestamp.nanos;

  if (!Number.isSafeInteger(seconds) || !Number.isInteger(nanos)) {
    throw new Error("Fabric returned an invalid transaction timestamp.");
  }

  const timestampMilliseconds = seconds * 1_000 + Math.floor(nanos / 1_000_000);
  const timestampDate = new Date(timestampMilliseconds);
  if (Number.isNaN(timestampDate.getTime())) {
    throw new Error("Fabric returned an invalid transaction timestamp.");
  }

  const txId = ctx.stub.getTxID()?.trim();
  if (!txId) {
    throw new Error("Fabric returned an empty transaction ID.");
  }

  return {
    txId,
    timestamp: timestampDate.toISOString(),
    invokingCertificateId: getInvokingIdentity(ctx).certificateId
  };
}
