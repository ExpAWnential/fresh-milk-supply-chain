import assert from "node:assert/strict";
import test from "node:test";
import { BatchLifecycleContract } from "../dist/contracts/BatchLifecycleContract.js";
import { TemperatureComplianceContract } from "../dist/contracts/TemperatureComplianceContract.js";
import { MemoryStub, context as as, transact } from "./fabricStub.mjs";

async function batchInTransit(stub) {
  await transact(stub, "cert-farm", (ctx) =>
    new BatchLifecycleContract().createBatch(ctx, "B-1", "Bega Dairy", "Bega NSW")
  );
  await transact(stub, "cert-processor", (ctx) =>
    new BatchLifecycleContract().recordProcessingEvent(ctx, "B-1", "Plant")
  );
  await transact(stub, "cert-logistics", (ctx) =>
    new BatchLifecycleContract().startTransport(ctx, "B-1", "Highway")
  );
}

test("a recalled batch cannot be recalled twice or continue its journey", async () => {
  const contract = new BatchLifecycleContract();
  const stub = new MemoryStub();
  await batchInTransit(stub);

  await transact(stub, "cert-regulator", (ctx) =>
    contract.recallBatch(ctx, "B-1", "contamination")
  );

  await assert.rejects(
    contract.recallBatch(as(stub, "cert-regulator"), "B-1", "again"),
    /already recalled/
  );
  await assert.rejects(
    contract.recordDelivery(as(stub, "cert-retailer"), "B-1", "Depot"),
    /cannot move from 'RECALLED' to 'DELIVERED'/
  );

  const recalled = JSON.parse(await contract.getBatch(as(stub, "cert-farm"), "B-1"));
  assert.equal(recalled.recallReason, "contamination");
  assert.equal(recalled.recalledByStakeholderId, "regulator-001");
  assert.equal(recalled.origin, "Bega Dairy");
  assert.equal(recalled.lastKnownLocation, "Highway");
});

test("only a regulator may recall, and the reason is required", async () => {
  const contract = new BatchLifecycleContract();
  const stub = new MemoryStub();
  await batchInTransit(stub);

  await assert.rejects(
    contract.recallBatch(as(stub, "cert-retailer"), "B-1", "because"),
    /requires one of: REGULATOR/
  );
  await assert.rejects(
    contract.recallBatch(as(stub, "cert-regulator"), "B-1", "   "),
    /Recall reason must not be empty/
  );
});

test("queries reject an unknown status and report an empty result honestly", async () => {
  const contract = new BatchLifecycleContract();
  const stub = new MemoryStub();
  await batchInTransit(stub);

  await assert.rejects(
    contract.queryBatchesByStatus(as(stub, "cert-farm"), "MELTED"),
    /Invalid batch status 'MELTED'/
  );
  assert.deepEqual(
    JSON.parse(await contract.queryBatchesByStatus(as(stub, "cert-farm"), "DELIVERED")),
    []
  );
  assert.deepEqual(
    JSON.parse(await contract.queryBatchesByStatus(as(stub, "cert-farm"), "in_transit")).map(
      (batch) => batch.batchId
    ),
    ["B-1"]
  );
});

test("history and reads reject a batch that does not exist", async () => {
  const contract = new BatchLifecycleContract();
  const stub = new MemoryStub();
  await batchInTransit(stub);

  await assert.rejects(contract.getBatch(as(stub, "cert-farm"), "MISSING"), /does not exist/);
  await assert.rejects(
    contract.getBatchHistory(as(stub, "cert-farm"), "MISSING"),
    /does not exist/
  );
  await assert.rejects(contract.getBatch(as(stub, "cert-farm"), "   "), /must not be empty/);
});

test("a corrupted ledger record is refused rather than parsed loosely", async () => {
  const contract = new BatchLifecycleContract();
  const stub = new MemoryStub();
  const key = stub.createCompositeKey("batch", ["B-9"]);

  await stub.putState(key, Buffer.from("not json"));
  await assert.rejects(contract.getBatch(as(stub, "cert-farm"), "B-9"), /invalid ledger data/);

  await stub.putState(key, Buffer.from(JSON.stringify({ batchId: "B-9", status: "MELTED" })));
  await assert.rejects(contract.getBatch(as(stub, "cert-farm"), "B-9"), /invalid ledger data/);

  await stub.putState(
    key,
    Buffer.from(
      JSON.stringify({
        batchId: "SOMETHING-ELSE",
        status: "CREATED",
        createdByStakeholderId: "farm-001",
        createdTxId: "tx-1",
        createdAt: "2026-07-30T00:00:00.000Z",
        lastUpdatedByStakeholderId: "farm-001",
        lastUpdatedTxId: "tx-1",
        lastUpdatedAt: "2026-07-30T00:00:00.000Z"
      })
    )
  );
  await assert.rejects(contract.getBatch(as(stub, "cert-farm"), "B-9"), /invalid ledger data/);
});

test("a ledger record that is valid JSON but not a record is refused too", async () => {
  const contract = new BatchLifecycleContract();
  const stub = new MemoryStub();
  const key = stub.createCompositeKey("batch", ["B-9"]);

  for (const stored of ["null", "42", '"a string"', "[]", "true"]) {
    await stub.putState(key, Buffer.from(stored));
    await assert.rejects(
      contract.getBatch(as(stub, "cert-farm"), "B-9"),
      /invalid ledger data/,
      stored
    );
  }
});

test("history entries the peer cannot date are refused rather than guessed at", async () => {
  const contract = new BatchLifecycleContract();
  const stub = new MemoryStub();

  await transact(stub, "cert-farm", (ctx) =>
    contract.createBatch(ctx, "B-1", "Bega Dairy", "Bega NSW")
  );
  const key = stub.createCompositeKey("batch", ["B-1"]);
  const [entry] = stub.history.get(key);

  const unusable = [
    undefined,
    // Integer timestamp parts can still exceed JavaScript's date range.
    { seconds: 1e15, nanos: 0 },
    { seconds: Number.MAX_SAFE_INTEGER * 2, nanos: 0 },
    { seconds: 1_750_000_000, nanos: 1.5 }
  ];

  for (const timestamp of unusable) {
    stub.history.set(key, [{ ...entry, timestamp }]);
    await assert.rejects(
      contract.getBatchHistory(as(stub, "cert-farm"), "B-1"),
      /timestamp/i,
      JSON.stringify(timestamp)
    );
  }
});

test("temperature evidence is refused for an unknown batch and read back only when it exists", async () => {
  const temperature = new TemperatureComplianceContract();
  const stub = new MemoryStub();
  await batchInTransit(stub);

  await assert.rejects(
    temperature.submitTemperatureEvidence(
      as(stub, "cert-oracle"),
      "EV-1",
      "MISSING",
      "a".repeat(64),
      "ref",
      JSON.stringify({ minCelsius: 1, maxCelsius: 4, readingCount: 3 })
    ),
    /Batch 'MISSING' does not exist/
  );

  await assert.rejects(
    temperature.getTemperatureEvidence(as(stub, "cert-oracle"), "EV-NOPE"),
    /does not exist/
  );
  await assert.rejects(
    temperature.getTemperatureEvidence(as(stub, "cert-oracle"), "  "),
    /must not be empty/
  );
});

test("evidence fields are validated before anything is written", async () => {
  const temperature = new TemperatureComplianceContract();
  const stub = new MemoryStub();
  await batchInTransit(stub);
  const stats = JSON.stringify({ minCelsius: 1, maxCelsius: 4, readingCount: 3 });
  const oracle = () => as(stub, "cert-oracle");

  const cases = [
    ["  ", "B-1", "a".repeat(64), "ref", stats, /Evidence ID must not be empty/],
    ["EV-1", "  ", "a".repeat(64), "ref", stats, /Batch ID must not be empty/],
    ["EV-1", "B-1", "a".repeat(63), "ref", stats, /64-character hexadecimal/],
    ["EV-1", "B-1", "z".repeat(64), "ref", stats, /64-character hexadecimal/],
    ["EV-1", "B-1", "a".repeat(64), "  ", stats, /Off-chain reference must not be empty/],
    ["EV-1", "B-1", "a".repeat(64), "ref", "not json", /must be valid JSON/],
    ["EV-1", "B-1", "a".repeat(64), "ref", "[1,2]", /must be a JSON object/],
    [
      "EV-1",
      "B-1",
      "a".repeat(64),
      "ref",
      JSON.stringify({ minCelsius: 1, maxCelsius: 4, readingCount: 0 }),
      /positive integer/
    ],
    [
      "EV-1",
      "B-1",
      "a".repeat(64),
      "ref",
      JSON.stringify({ minCelsius: "cold", maxCelsius: 4, readingCount: 3 }),
      /finite number/
    ]
  ];

  for (const [evidenceId, batchId, hash, reference, statistics, expected] of cases) {
    await assert.rejects(
      temperature.submitTemperatureEvidence(
        oracle(),
        evidenceId,
        batchId,
        hash,
        reference,
        statistics
      ),
      expected
    );
  }
});

test("an uppercase hash is stored in lower case so comparisons cannot drift", async () => {
  const temperature = new TemperatureComplianceContract();
  const stub = new MemoryStub();
  await batchInTransit(stub);

  await transact(stub, "cert-oracle", (ctx) =>
    temperature.submitTemperatureEvidence(
      ctx,
      "EV-1",
      "B-1",
      "A".repeat(64),
      "ref",
      JSON.stringify({ minCelsius: 1, maxCelsius: 4, readingCount: 3 })
    )
  );

  const evidence = JSON.parse(
    await temperature.getTemperatureEvidence(as(stub, "cert-oracle"), "EV-1")
  );
  assert.equal(evidence.evidenceHash, "a".repeat(64));
});

test("a breach can only be cleared once, and only from a breached batch", async () => {
  const temperature = new TemperatureComplianceContract();
  const stub = new MemoryStub();
  await batchInTransit(stub);

  await assert.rejects(
    temperature.resolveTemperatureBreach(as(stub, "cert-regulator"), "B-1", "nothing wrong"),
    /does not have an unresolved cold-chain breach/
  );

  await transact(stub, "cert-oracle", (ctx) =>
    temperature.submitTemperatureEvidence(
      ctx,
      "EV-2",
      "B-1",
      "b".repeat(64),
      "ref",
      JSON.stringify({ minCelsius: 1, maxCelsius: 9, readingCount: 3 })
    )
  );

  await assert.rejects(
    temperature.resolveTemperatureBreach(as(stub, "cert-regulator"), "B-1", "  "),
    /Resolution reason must not be empty/
  );

  await transact(stub, "cert-regulator", (ctx) =>
    temperature.resolveTemperatureBreach(ctx, "B-1", "inspected")
  );
  await assert.rejects(
    temperature.resolveTemperatureBreach(as(stub, "cert-regulator"), "B-1", "again"),
    /does not have an unresolved cold-chain breach/
  );
});

test("the same evidence cannot be anchored twice", async () => {
  const temperature = new TemperatureComplianceContract();
  const stub = new MemoryStub();
  await batchInTransit(stub);
  const submit = (ctx) =>
    temperature.submitTemperatureEvidence(
      ctx,
      "EV-3",
      "B-1",
      "c".repeat(64),
      "ref",
      JSON.stringify({ minCelsius: 1, maxCelsius: 4, readingCount: 3 })
    );

  await transact(stub, "cert-oracle", submit);
  await assert.rejects(submit(as(stub, "cert-oracle")), /already exists/);
});
