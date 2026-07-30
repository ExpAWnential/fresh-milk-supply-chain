import assert from "node:assert/strict";
import test from "node:test";
import { TemperatureComplianceContract } from "../dist/contracts/TemperatureComplianceContract.js";

const VALID_HASH_A = "a".repeat(64);
const VALID_HASH_B = "b".repeat(64);

class MemoryStub {
  state = new Map();
  events = [];
  txNumber = 1;
  currentCertificateId = "";

  stakeholders = new Map([
    ["cert-oracle", { stakeholderId: "oracle-001", role: "ORACLE", active: true }],
    ["cert-regulator", { stakeholderId: "regulator-001", role: "REGULATOR", active: true }],
    ["cert-retailer", { stakeholderId: "retailer-001", role: "RETAILER", active: true }],
    ["cert-suspended-oracle", { stakeholderId: "oracle-002", role: "ORACLE", active: false }]
  ]);

  createCompositeKey(objectType, attributes) {
    return `${objectType}\u0000${attributes.join("\u0000")}\u0000`;
  }

  async getState(key) {
    return this.state.get(key) ?? Buffer.alloc(0);
  }

  async putState(key, value) {
    this.state.set(key, Buffer.from(value));
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
    if (chaincodeName !== "stakeholder") {
      return { status: 500, message: "Unexpected chaincode", payload: Buffer.alloc(0) };
    }
    if (args[0] !== "StakeholderRegistryContract:assertActiveRole") {
      return { status: 500, message: "Unexpected transaction", payload: Buffer.alloc(0) };
    }
    if (args[1] !== this.currentCertificateId) {
      return { status: 500, message: "Certificate mismatch", payload: Buffer.alloc(0) };
    }

    const stakeholder = this.stakeholders.get(this.currentCertificateId);
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
  assert.equal(
    await contract.verifyEvidenceReference(ctx, "EVIDENCE-001", VALID_HASH_A),
    true
  );
  assert.equal(
    await contract.verifyEvidenceReference(ctx, "EVIDENCE-001", VALID_HASH_B),
    false
  );
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
