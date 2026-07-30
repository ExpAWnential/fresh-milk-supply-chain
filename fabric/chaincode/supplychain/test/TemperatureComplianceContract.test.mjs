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

function statistics(minCelsius, maxCelsius, averageCelsius, readingCount = 3) {
  return JSON.stringify({ minCelsius, maxCelsius, averageCelsius, readingCount });
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
    statistics(0, 5, 2.5)
  );

  const evidence = JSON.parse(
    await contract.getTemperatureEvidence(ctx, "EVIDENCE-001")
  );
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
    statistics(-0.2, 5.4, 2.1)
  );

  const evidence = JSON.parse(
    await contract.getTemperatureEvidence(ctx, "EVIDENCE-002")
  );
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
  await seedBatch(stub, "BATCH-004", "PROCESSED");

  await assert.rejects(
    contract.submitTemperatureEvidence(
      context(stub, "cert-retailer"),
      "EVIDENCE-003",
      "BATCH-003",
      VALID_HASH_A,
      "ref-003",
      statistics(1, 4, 2.5)
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
      statistics(1, 4, 2.5)
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
    statistics(1, 4, 2.5)
  );

  await assert.rejects(
    contract.submitTemperatureEvidence(
      oracleContext,
      "EVIDENCE-003",
      "BATCH-003",
      VALID_HASH_B,
      "ref-duplicate",
      statistics(1, 4, 2.5)
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
      statistics(1, 4, 2.5)
    ),
    /must be IN_TRANSIT/
  );
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
      statistics(1, 4, 2.5)
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
      statistics(4, 2, 3)
    ),
    /minCelsius.*must not exceed/
  );

  await assert.rejects(
    contract.submitTemperatureEvidence(
      ctx,
      "EVIDENCE-005",
      "BATCH-005",
      VALID_HASH_A,
      "ref-005",
      statistics(1, 4, 9)
    ),
    /averageCelsius.*between/
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
    statistics(1, 5.1, 3)
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
