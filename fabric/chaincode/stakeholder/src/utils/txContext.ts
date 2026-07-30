import type { Context } from "fabric-contract-api";
import { getInvokingIdentity } from "./identity.js";

export interface TransactionMetadata {
  // Fabric's unique ID for this transaction.
  readonly txId: string;
  readonly timestamp: string;
  readonly invokingCertificateId: string;
}

// Build audit metadata from Fabric itself rather than accepting an ID, time,
// or caller identity from an API request
export function getTransactionMetadata(ctx: Context): TransactionMetadata {
  // Fabric supplies one timestamp as whole seconds plus extra nanoseconds
  const timestamp = ctx.stub.getTxTimestamp();
  const seconds = Number(timestamp.seconds.toString());
  const nanos = timestamp.nanos;

  // Reject malformed timestamp values before using them in ledger data
  if (!Number.isSafeInteger(seconds) || !Number.isInteger(nanos)) {
    throw new Error("Fabric returned an invalid transaction timestamp.");
  }

  // JavaScript Date uses milliseconds so convert Fabric's seconds/nanoseconds
  const timestampMilliseconds = seconds * 1_000 + Math.floor(nanos / 1_000_000);
  const timestampDate = new Date(timestampMilliseconds);

  // An invalid Date would make the audit record unreliable
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
