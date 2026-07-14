import { Context } from "fabric-contract-api";

export interface TransactionMetadata {
  readonly txId: string;
  readonly timestamp: string;
  readonly invokingCertificateId: string;
}

export function getTransactionMetadata(_ctx: Context): TransactionMetadata {
  // TODO: Return Fabric transaction ID, transaction timestamp and invoking stakeholder identity.
  throw new Error("getTransactionMetadata is not implemented yet.");
}
