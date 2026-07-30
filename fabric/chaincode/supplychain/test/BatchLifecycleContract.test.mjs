import assert from "node:assert/strict";
import test from "node:test";
import { BatchLifecycleContract } from "../dist/contracts/BatchLifecycleContract.js";

class MemoryIterator {
  #items;
  #index = 0;
  closed = false;

  constructor(items) {
    this.#items = items;
  }

  async next() {
    if (this.#index >= this.#items.length) {
      return { done: true };
    }
    return { done: false, value: this.#items[this.#index++] };
  }

  async close() {
    this.closed = true;
  }
}

class MemoryStub {
  state = new Map();
  history = new Map();
  events = [];
  txNumber = 1;
  currentCertificateId = "";

  stakeholders = new Map([
    ["cert-farm", { stakeholderId: "farm-001", role: "FARM", active: true }],
    ["cert-processor", { stakeholderId: "processor-001", role: "PROCESSOR", active: true }],
    ["cert-logistics", { stakeholderId: "logistics-001", role: "LOGISTICS", active: true }],
    ["cert-retailer", { stakeholderId: "retailer-001", role: "RETAILER", active: true }],
    ["cert-regulator", { stakeholderId: "regulator-001", role: "REGULATOR", active: true }],
    ["cert-suspended", { stakeholderId: "processor-002", role: "PROCESSOR", active: false }]
  ]);

  createCompositeKey(objectType, attributes) {
    return `${objectType}\u0000${attributes.join("\u0000")}\u0000`;
  }

  async getState(key) {
    return this.state.get(key) ?? Buffer.alloc(0);
  }

  async putState(key, value) {
    const storedValue = Buffer.from(value);
    this.state.set(key, storedValue);
    const entries = this.history.get(key) ?? [];
    entries.push({
      txId: this.getTxID(),
      timestamp: this.getTxTimestamp(),
      isDelete: false,
      value: storedValue
    });
    this.history.set(key, entries);
  }

  async getHistoryForKey(key) {
    return new MemoryIterator(this.history.get(key) ?? []);
  }

  async getQueryResult(query) {
    const { selector } = JSON.parse(query);
    const rows = [...this.state.entries()]
      .filter(([key, value]) => {
        if (!key.startsWith("batch\u0000")) {
          return false;
        }
        return JSON.parse(value.toString()).status === selector.status;
      })
      .map(([key, value]) => ({ key, value }));
    return new MemoryIterator(rows);
  }

  getTxID() {
    return `tx-${this.txNumber}`;
  }

  getTxTimestamp() {
    return {
      seconds: 1_750_000_000 + this.txNumber,
      nanos: 123_000_000
    };
  }

  setEvent(name, payload) {
    this.events.push({ name, payload: Buffer.from(payload) });
  }

  async invokeChaincode(chaincodeName, args) {
    if (
      chaincodeName !== "stakeholder" ||
      args[0] !== "StakeholderRegistryContract:assertActiveRole"
    ) {
      return { status: 500, message: "Unexpected chaincode invocation", payload: Buffer.alloc(0) };
    }

    const stakeholder = this.stakeholders.get(args[1]);
    if (!stakeholder) {
      return {
        status: 500,
        message: "The invoking certificate is not registered to a stakeholder.",
        payload: Buffer.alloc(0)
      };
    }
    if (!stakeholder.active) {
      return {
        status: 500,
        message: `Stakeholder '${stakeholder.stakeholderId}' is suspended.`,
        payload: Buffer.alloc(0)
      };
    }

    const allowedRoles = JSON.parse(args[2]);
    if (!allowedRoles.includes(stakeholder.role)) {
      return {
        status: 500,
        message:
          `Stakeholder '${stakeholder.stakeholderId}' has role '${stakeholder.role}', ` +
          `but this operation requires one of: ${allowedRoles.join(", ")}.`,
        payload: Buffer.alloc(0)
      };
    }

    return {
      status: 200,
      message: "OK",
      payload: Buffer.from(JSON.stringify(stakeholder))
    };
  }

  nextTransaction() {
    this.txNumber += 1;
  }
}

function context(stub, certificateId) {
  stub.currentCertificateId = certificateId;
  return {
    stub,
    clientIdentity: {
      getID: () => certificateId,
      getMSPID: () => "SupplyChainMSP"
    }
  };
}

async function transact(stub, certificateId, operation) {
  const result = await operation(context(stub, certificateId));
  stub.nextTransaction();
  return result;
}

test("a batch follows the complete CREATED to DELIVERED lifecycle with full history", async () => {
  const contract = new BatchLifecycleContract();
  const stub = new MemoryStub();

  await transact(stub, "cert-farm", (ctx) => contract.createBatch(ctx, " BATCH-001 ", " Green Pastures Dairy ", "Bega NSW"));
  await transact(stub, "cert-processor", (ctx) =>
    contract.recordProcessingEvent(ctx, "BATCH-001", "Bega Processing Plant")
  );
  await transact(stub, "cert-logistics", (ctx) => contract.startTransport(ctx, "BATCH-001", "Hume Highway"));
  await transact(stub, "cert-retailer", (ctx) => contract.recordDelivery(ctx, "BATCH-001", "Sydney Retail Depot"));

  const batch = JSON.parse(await contract.getBatch(context(stub, "cert-farm"), "BATCH-001"));
  assert.equal(batch.status, "DELIVERED");
  assert.equal(batch.origin, "Green Pastures Dairy");
  assert.equal(batch.createdByStakeholderId, "farm-001");
  assert.equal(batch.lastUpdatedByStakeholderId, "retailer-001");
  assert.deepEqual(
    stub.events.map((event) => event.name),
    ["BatchCreated", "BatchProcessed", "BatchTransportStarted", "BatchDelivered"]
  );

  const history = JSON.parse(
    await contract.getBatchHistory(context(stub, "cert-farm"), "BATCH-001")
  );
  assert.deepEqual(
    history.map((entry) => entry.batch.status),
    ["CREATED", "PROCESSED", "IN_TRANSIT", "DELIVERED"]
  );
  assert.deepEqual(
    history.map((entry) => entry.submittedByStakeholderId),
    ["farm-001", "processor-001", "logistics-001", "retailer-001"]
  );
  assert.deepEqual(
    history.map((entry) => entry.txId),
    ["tx-1", "tx-2", "tx-3", "tx-4"]
  );
  // The history carries the whole record at each step, so it shows where the batch was.
  assert.deepEqual(
    history.map((entry) => entry.batch.lastKnownLocation),
    ["Bega NSW", "Bega Processing Plant", "Hume Highway", "Sydney Retail Depot"]
  );

  const delivered = JSON.parse(
    await contract.queryBatchesByStatus(context(stub, "cert-farm"), "delivered")
  );
  assert.deepEqual(delivered.map((item) => item.batchId), ["BATCH-001"]);
});

test("duplicate IDs, incorrect roles and invalid lifecycle steps are rejected", async () => {
  const contract = new BatchLifecycleContract();
  const stub = new MemoryStub();

  await assert.rejects(
    contract.createBatch(context(stub, "cert-retailer"), "BATCH-002", "Green Pastures Dairy", "Bega NSW"),
    /requires one of: FARM, PROCESSOR/
  );
  await assert.rejects(
    contract.createBatch(context(stub, "cert-suspended"), "BATCH-002", "Green Pastures Dairy", "Bega NSW"),
    /is suspended/
  );
  await assert.rejects(
    contract.createBatch(context(stub, "cert-farm"), "BATCH-002", "   ", "Bega NSW"),
    /Origin must not be empty/
  );

  await transact(stub, "cert-farm", (ctx) => contract.createBatch(ctx, "BATCH-002", "Green Pastures Dairy", "Bega NSW"));
  await assert.rejects(
    contract.createBatch(context(stub, "cert-farm"), "BATCH-002", "Green Pastures Dairy", "Bega NSW"),
    /already exists/
  );
  await assert.rejects(
    contract.startTransport(context(stub, "cert-logistics"), "BATCH-002", "Hume Highway"),
    /cannot move from 'CREATED' to 'IN_TRANSIT'/
  );
  await assert.rejects(
    contract.recordProcessingEvent(context(stub, "cert-farm"), "BATCH-002", "Bega Processing Plant"),
    /requires one of: PROCESSOR/
  );
  await assert.rejects(
    contract.getBatch(context(stub, "cert-farm"), "UNKNOWN"),
    /does not exist/
  );
});

// Reading is a permission too, not just writing. A network member who is not a registered
// stakeholder, or one that has been suspended, must not be able to read batch records.
test("reads are refused to unregistered and suspended callers", async () => {
  const contract = new BatchLifecycleContract();
  const stub = new MemoryStub();
  await transact(stub, "cert-farm", (ctx) =>
    contract.createBatch(ctx, "BATCH-005", "Green Pastures Dairy", "Bega NSW")
  );

  for (const [certificateId, expected] of [
    ["cert-unknown", /not registered to a stakeholder/],
    ["cert-suspended", /is suspended/]
  ]) {
    await assert.rejects(contract.getBatch(context(stub, certificateId), "BATCH-005"), expected);
    await assert.rejects(
      contract.getBatchHistory(context(stub, certificateId), "BATCH-005"),
      expected
    );
    await assert.rejects(
      contract.queryBatchesByStatus(context(stub, certificateId), "CREATED"),
      expected
    );
  }
});

test("a regulator can recall a batch and recalled batches cannot continue", async () => {
  const contract = new BatchLifecycleContract();
  const stub = new MemoryStub();

  await transact(stub, "cert-farm", (ctx) => contract.createBatch(ctx, "BATCH-003", "Green Pastures Dairy", "Bega NSW"));
  await transact(stub, "cert-processor", (ctx) =>
    contract.recordProcessingEvent(ctx, "BATCH-003", "Bega Processing Plant")
  );

  await assert.rejects(
    contract.recallBatch(context(stub, "cert-retailer"), "BATCH-003", "Quality concern"),
    /requires one of: REGULATOR/
  );
  await transact(stub, "cert-regulator", (ctx) =>
    contract.recallBatch(ctx, "BATCH-003", " Supplier contamination notice ")
  );

  const recalled = JSON.parse(
    await contract.getBatch(context(stub, "cert-regulator"), "BATCH-003")
  );
  assert.equal(recalled.status, "RECALLED");
  assert.equal(recalled.recallReason, "Supplier contamination notice");
  assert.equal(recalled.recalledByStakeholderId, "regulator-001");
  assert.equal(stub.events.at(-1).name, "BatchRecalled");

  await assert.rejects(
    contract.startTransport(context(stub, "cert-logistics"), "BATCH-003", "Hume Highway"),
    /cannot move from 'RECALLED'/
  );
  await assert.rejects(
    contract.recallBatch(context(stub, "cert-regulator"), "BATCH-003", "Again"),
    /already recalled/
  );
});

test("delivery is blocked while a cold-chain breach is unresolved", async () => {
  const contract = new BatchLifecycleContract();
  const stub = new MemoryStub();
  const breachedBatch = {
    batchId: "BATCH-004",
    status: "COLD_CHAIN_BREACH",
    origin: "Green Pastures Dairy",
    lastKnownLocation: "Hume Highway",
    createdByStakeholderId: "farm-001",
    createdTxId: "tx-create",
    createdAt: "2026-07-29T00:00:00.000Z",
    lastUpdatedByStakeholderId: "oracle-001",
    lastUpdatedTxId: "tx-breach",
    lastUpdatedAt: "2026-07-29T01:00:00.000Z"
  };
  await stub.putState(
    stub.createCompositeKey("batch", ["BATCH-004"]),
    Buffer.from(JSON.stringify(breachedBatch))
  );

  await assert.rejects(
    contract.recordDelivery(context(stub, "cert-retailer"), "BATCH-004", "Sydney Retail Depot"),
    /cannot move from 'COLD_CHAIN_BREACH' to 'DELIVERED'/
  );
  await assert.rejects(
    contract.queryBatchesByStatus(context(stub, "cert-retailer"), "not-a-status"),
    /Invalid batch status/
  );
});
