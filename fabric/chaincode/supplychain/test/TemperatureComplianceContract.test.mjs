import assert from "node:assert/strict";
import test from "node:test";
import { TemperatureComplianceContract } from "../dist/contracts/TemperatureComplianceContract.js";
import { MemoryStub, context } from "./fabricStub.mjs";

const VALID_HASH_A = "a".repeat(64);
const VALID_HASH_B = "b".repeat(64);

function batchRecord(batchId, status = "IN_TRANSIT") {
  return {
    batchId,
    status,
    origin: "Green Pastures Dairy",
    lastKnownLocation: "Hume Highway",
    createdByStakeholderId: "farm-001",
    createdTxId: "tx-create",
    createdAt: "2026-07-27T00:00:00.000Z",
    lastUpdatedByStakeholderId: "logistics-001",
    lastUpdatedTxId: "tx-transport",
    lastUpdatedAt: "2026-07-27T01:00:00.000Z"
  };
}

async function seedBatch(stub, batchId, status = "IN_TRANSIT") {
  const key = stub.createCompositeKey("batch", [batchId]);
  await stub.putState(key, Buffer.from(JSON.stringify(batchRecord(batchId, status))));
}

function statistics(minCelsius, maxCelsius, readingCount = 3) {
  return JSON.stringify({ minCelsius, maxCelsius, readingCount });
}

test("ORACLE can anchor boundary-safe evidence and the contract derives COMPLIANT", async () => {
  const contract = new TemperatureComplianceContract();
  const stub = new MemoryStub();
  await seedBatch(stub, "BATCH-001");
  const ctx = context(stub, "cert-oracle");

  await contract.submitTemperatureEvidence(
    ctx,
    "EVIDENCE-001",
    "BATCH-001",
    VALID_HASH_A.toUpperCase(),
    "postgres://temperature/EVIDENCE-001",
    statistics(0, 5)
  );

  const evidence = JSON.parse(await contract.getTemperatureEvidence(ctx, "EVIDENCE-001"));
  assert.equal(evidence.complianceOutcome, "COMPLIANT");
  assert.equal(evidence.evidenceHash, VALID_HASH_A);
  assert.equal(evidence.submittedByStakeholderId, "oracle-001");
  assert.equal(evidence.submittedTxId, "tx-1");

  const batch = JSON.parse(
    (await stub.getState(stub.createCompositeKey("batch", ["BATCH-001"]))).toString()
  );
  assert.equal(batch.status, "IN_TRANSIT");
  assert.equal(stub.events.at(-1).name, "TemperatureEvidenceSubmitted");
});

test("unsafe evidence flags the batch and emits ColdChainBreach", async () => {
  const contract = new TemperatureComplianceContract();
  const stub = new MemoryStub();
  await seedBatch(stub, "BATCH-002");
  const ctx = context(stub, "cert-oracle");

  await contract.submitTemperatureEvidence(
    ctx,
    "EVIDENCE-002",
    "BATCH-002",
    VALID_HASH_B,
    "postgres://temperature/EVIDENCE-002",
    statistics(-0.2, 5.4)
  );

  const evidence = JSON.parse(await contract.getTemperatureEvidence(ctx, "EVIDENCE-002"));
  assert.equal(evidence.complianceOutcome, "UNSAFE");

  const batch = JSON.parse(
    (await stub.getState(stub.createCompositeKey("batch", ["BATCH-002"]))).toString()
  );
  assert.equal(batch.status, "COLD_CHAIN_BREACH");
  assert.equal(batch.lastUpdatedByStakeholderId, "oracle-001");
  assert.equal(batch.lastUpdatedTxId, "tx-1");
  assert.equal(stub.events.at(-1).name, "ColdChainBreach");
  const event = JSON.parse(stub.events.at(-1).payload.toString());
  assert.equal(event.batchId, "BATCH-002");
  assert.equal(event.txId, "tx-1");
});

test("submission rejects the wrong role, suspended oracle, duplicates and invalid batch state", async () => {
  const contract = new TemperatureComplianceContract();
  const stub = new MemoryStub();
  await seedBatch(stub, "BATCH-003");
  await seedBatch(stub, "BATCH-004", "RECALLED");

  await assert.rejects(
    contract.submitTemperatureEvidence(
      context(stub, "cert-retailer"),
      "EVIDENCE-003",
      "BATCH-003",
      VALID_HASH_A,
      "ref-003",
      statistics(1, 4)
    ),
    /requires one of: ORACLE/
  );

  await assert.rejects(
    contract.submitTemperatureEvidence(
      context(stub, "cert-suspended-oracle"),
      "EVIDENCE-003",
      "BATCH-003",
      VALID_HASH_A,
      "ref-003",
      statistics(1, 4)
    ),
    /is suspended/
  );

  const oracleContext = context(stub, "cert-oracle");
  await contract.submitTemperatureEvidence(
    oracleContext,
    "EVIDENCE-003",
    "BATCH-003",
    VALID_HASH_A,
    "ref-003",
    statistics(1, 4)
  );

  await assert.rejects(
    contract.submitTemperatureEvidence(
      oracleContext,
      "EVIDENCE-003",
      "BATCH-003",
      VALID_HASH_B,
      "ref-duplicate",
      statistics(1, 4)
    ),
    /already exists/
  );

  await assert.rejects(
    contract.submitTemperatureEvidence(
      oracleContext,
      "EVIDENCE-004",
      "BATCH-004",
      VALID_HASH_B,
      "ref-004",
      statistics(1, 4)
    ),
    /has been recalled/
  );
});

// The cold chain runs from the farm's tank to the retailer's fridge, so a breach has to be
// recordable wherever the milk actually is, not only while it is on a truck.
test("evidence is accepted at every stage and a breach returns the batch to where it happened", async () => {
  for (const status of ["CREATED", "PROCESSED", "IN_TRANSIT", "DELIVERED"]) {
    const contract = new TemperatureComplianceContract();
    const stub = new MemoryStub();
    await seedBatch(stub, "BATCH-STAGE", status);

    await contract.submitTemperatureEvidence(
      context(stub, "cert-oracle"),
      "EVIDENCE-STAGE",
      "BATCH-STAGE",
      VALID_HASH_A,
      "ref-stage",
      statistics(1, 9)
    );

    const key = stub.createCompositeKey("batch", ["BATCH-STAGE"]);
    const breached = JSON.parse((await stub.getState(key)).toString());
    assert.equal(breached.status, "COLD_CHAIN_BREACH", `breach not recorded from ${status}`);
    assert.equal(breached.statusBeforeBreach, status);

    await contract.resolveTemperatureBreach(
      context(stub, "cert-regulator"),
      "BATCH-STAGE",
      "Inspection completed."
    );

    const resolved = JSON.parse((await stub.getState(key)).toString());
    // Not IN_TRANSIT unless that is genuinely where it was, otherwise clearing a breach at the
    // farm would push the batch forward past processing.
    assert.equal(resolved.status, status, `resolve did not restore ${status}`);
    assert.equal(resolved.statusBeforeBreach, undefined);
  }
});

test("a second unsafe reading during an open hold keeps the original stage", async () => {
  const contract = new TemperatureComplianceContract();
  const stub = new MemoryStub();
  await seedBatch(stub, "BATCH-007", "PROCESSED");
  const oracleContext = context(stub, "cert-oracle");

  const unsafe = statistics(1, 9);
  await contract.submitTemperatureEvidence(
    oracleContext,
    "EVIDENCE-007A",
    "BATCH-007",
    VALID_HASH_A,
    "ref-007a",
    unsafe
  );
  await contract.submitTemperatureEvidence(
    oracleContext,
    "EVIDENCE-007B",
    "BATCH-007",
    VALID_HASH_B,
    "ref-007b",
    unsafe
  );

  const batch = JSON.parse(
    (await stub.getState(stub.createCompositeKey("batch", ["BATCH-007"]))).toString()
  );
  assert.equal(batch.status, "COLD_CHAIN_BREACH");
  assert.equal(batch.statusBeforeBreach, "PROCESSED");
});

test("statistics and hash validation reject malformed evidence", async () => {
  const contract = new TemperatureComplianceContract();
  const stub = new MemoryStub();
  await seedBatch(stub, "BATCH-005");
  const ctx = context(stub, "cert-oracle");

  await assert.rejects(
    contract.submitTemperatureEvidence(
      ctx,
      "EVIDENCE-005",
      "BATCH-005",
      "not-a-hash",
      "ref-005",
      statistics(1, 4)
    ),
    /64-character hexadecimal SHA-256/
  );

  await assert.rejects(
    contract.submitTemperatureEvidence(
      ctx,
      "EVIDENCE-005",
      "BATCH-005",
      VALID_HASH_A,
      "ref-005",
      statistics(4, 2)
    ),
    /minCelsius.*must not exceed/
  );
});

test("only a REGULATOR can resolve a breach and the batch returns to IN_TRANSIT", async () => {
  const contract = new TemperatureComplianceContract();
  const stub = new MemoryStub();
  await seedBatch(stub, "BATCH-006");

  await contract.submitTemperatureEvidence(
    context(stub, "cert-oracle"),
    "EVIDENCE-006",
    "BATCH-006",
    VALID_HASH_A,
    "ref-006",
    statistics(1, 5.1)
  );

  await assert.rejects(
    contract.resolveTemperatureBreach(
      context(stub, "cert-oracle"),
      "BATCH-006",
      "Checked refrigeration unit"
    ),
    /requires one of: REGULATOR/
  );

  await contract.resolveTemperatureBreach(
    context(stub, "cert-regulator"),
    "BATCH-006",
    "Independent inspection completed; transport may continue."
  );

  const batch = JSON.parse(
    (await stub.getState(stub.createCompositeKey("batch", ["BATCH-006"]))).toString()
  );
  assert.equal(batch.status, "IN_TRANSIT");
  assert.equal(batch.lastUpdatedByStakeholderId, "regulator-001");
  assert.equal(stub.events.at(-1).name, "ColdChainBreachResolved");

  const evidence = JSON.parse(
    await contract.getTemperatureEvidence(context(stub, "cert-regulator"), "EVIDENCE-006")
  );
  assert.equal(evidence.complianceOutcome, "UNSAFE");
});
