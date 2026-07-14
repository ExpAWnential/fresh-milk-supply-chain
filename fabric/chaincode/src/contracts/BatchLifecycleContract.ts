import { Contract, Context, Info, Transaction } from "fabric-contract-api";

@Info({
  title: "BatchLifecycleContract",
  description: "Creates milk batches and validates lifecycle transitions."
})
export class BatchLifecycleContract extends Contract {
  @Transaction()
  public async createBatch(_ctx: Context, _batchId: string): Promise<void> {
    // TODO: Allow only FARM or PROCESSOR identities to create a milk batch.
    // TODO: Record Fabric transaction ID, timestamp and invoking stakeholder identity.
    throw new Error("createBatch is not implemented yet.");
  }

  @Transaction()
  public async advanceLifecycle(_ctx: Context, _batchId: string, _nextStatus: string): Promise<void> {
    // TODO: Validate lifecycle transitions on-chain and reject out-of-order events.
    // TODO: Reject delivery when a batch is recalled or has COLD_CHAIN_BREACH status.
    throw new Error("advanceLifecycle is not implemented yet.");
  }

  @Transaction()
  public async recallBatch(_ctx: Context, _batchId: string, _reason: string): Promise<void> {
    // TODO: Allow only REGULATOR identities to recall a batch.
    throw new Error("recallBatch is not implemented yet.");
  }
}
