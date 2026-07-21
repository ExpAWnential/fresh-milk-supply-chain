import { Contract, Context, Info, Returns, Transaction } from "fabric-contract-api";

// One transaction per lifecycle step rather than a single generic advance, so each step
// carries its own role rule and can be tested in isolation.
@Info({
  title: "BatchLifecycleContract",
  description: "Creates milk batches and validates lifecycle transitions."
})
export class BatchLifecycleContract extends Contract {
  @Transaction()
  public async createBatch(_ctx: Context, _batchId: string): Promise<void> {
    // TODO: Allow only FARM or PROCESSOR stakeholders to create a milk batch.
    // TODO: Reject duplicate batch IDs.
    // TODO: Record Fabric transaction ID, transaction timestamp and invoking stakeholder identity.
    throw new Error("createBatch is not implemented yet.");
  }

  @Transaction()
  public async recordProcessingEvent(_ctx: Context, _batchId: string): Promise<void> {
    // TODO: Allow only PROCESSOR stakeholders, and only from the CREATED status.
    throw new Error("recordProcessingEvent is not implemented yet.");
  }

  @Transaction()
  public async startTransport(_ctx: Context, _batchId: string): Promise<void> {
    // TODO: Allow only LOGISTICS stakeholders, and only from the PROCESSED status.
    // TODO: Reject recalled batches.
    throw new Error("startTransport is not implemented yet.");
  }

  @Transaction()
  public async recordDelivery(_ctx: Context, _batchId: string): Promise<void> {
    // TODO: Allow only RETAILER stakeholders, and only from the IN_TRANSIT status.
    // TODO: Reject batches that are recalled or hold an unresolved COLD_CHAIN_BREACH.
    throw new Error("recordDelivery is not implemented yet.");
  }

  @Transaction()
  public async recallBatch(_ctx: Context, _batchId: string, _reason: string): Promise<void> {
    // TODO: Allow only REGULATOR stakeholders to recall a batch.
    throw new Error("recallBatch is not implemented yet.");
  }

  @Transaction(false)
  @Returns("string")
  public async getBatch(_ctx: Context, _batchId: string): Promise<string> {
    // TODO: Return the current batch record, or reject when it does not exist.
    throw new Error("getBatch is not implemented yet.");
  }

  @Transaction(false)
  @Returns("string")
  public async getBatchHistory(_ctx: Context, _batchId: string): Promise<string> {
    // TODO: Return the audit trail from GetHistoryForKey, including tx ID, timestamp and submitter.
    throw new Error("getBatchHistory is not implemented yet.");
  }

  @Transaction(false)
  @Returns("string")
  public async queryBatchesByStatus(_ctx: Context, _status: string): Promise<string> {
    // TODO: Run a CouchDB rich query over batches currently in the given status.
    throw new Error("queryBatchesByStatus is not implemented yet.");
  }
}
