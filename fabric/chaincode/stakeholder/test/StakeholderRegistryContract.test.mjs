import assert from "node:assert/strict";
import test from "node:test";
import {
  REGULATOR_MSP_ID,
  StakeholderRegistryContract
} from "../dist/contracts/StakeholderRegistryContract.js";
import { MemoryStub, context } from "./fabricStub.mjs";

async function expectReject(promise, pattern) {
  await assert.rejects(promise, pattern);
}

// The first regulator must come from the trusted regulator organisation, and
// the one time bootstrap must never be usable again after setup
test("only the regulator MSP can bootstrap the registry, and only once", async () => {
  const contract = new StakeholderRegistryContract();
  const stub = new MemoryStub();

  // A caller from the normal supply chain MSP must not become the first regulator
  await expectReject(
    contract.bootstrapRegulator(context(stub, "cert-attacker"), "attacker"),
    /Only a member of MSP 'Org1MSP'/
  );

  const regulatorContext = context(stub, "cert-regulator", REGULATOR_MSP_ID);
  await contract.bootstrapRegulator(regulatorContext, "regulator-001");

  // Confirm that bootstrap saved the correct role, certificate, status and audit ID
  const regulator = JSON.parse(
    await contract.getStakeholder(regulatorContext, "regulator-001")
  );
  assert.equal(regulator.role, "REGULATOR");
  assert.equal(regulator.certificateId, "cert-regulator");
  assert.equal(regulator.active, true);
  assert.equal(regulator.createdTxId, "tx-1");

  // Even the trusted organisation cannot bootstrap a second time
  await expectReject(
    contract.bootstrapRegulator(regulatorContext, "regulator-002"),
    /already been initialised/
  );
});

// An active regulator can add a valid stakeholder, but IDs, certificates and
// roles must satisfy the registry's validation rules
test("an active regulator can register stakeholders and duplicates are rejected", async () => {
  const contract = new StakeholderRegistryContract();
  const stub = new MemoryStub();
  const regulatorContext = context(stub, "cert-regulator", REGULATOR_MSP_ID);

  await contract.bootstrapRegulator(regulatorContext, "regulator-001");
  await contract.registerStakeholder(
    regulatorContext,
    "farm-001",
    "farm",
    "cert-farm"
  );

  const farm = JSON.parse(await contract.getStakeholder(regulatorContext, "farm-001"));
  assert.equal(farm.role, "FARM");
  assert.equal(farm.active, true);

  // A stakeholder ID identifies one business and cannot be reused
  await expectReject(
    contract.registerStakeholder(
      regulatorContext,
      "farm-001",
      "FARM",
      "cert-other"
    ),
    /already exists/
  );

  // One certificate cannot be connected to two different stakeholders
  await expectReject(
    contract.registerStakeholder(
      regulatorContext,
      "farm-002",
      "FARM",
      "cert-farm"
    ),
    /certificate ID is already registered/
  );

  // Only the six roles defined by the stakeholder model are accepted
  await expectReject(
    contract.registerStakeholder(
      regulatorContext,
      "farm-002",
      "UNKNOWN",
      "cert-other"
    ),
    /Invalid stakeholder role/
  );
});

// Having a registered certificate is not enough for administration: the caller
// must specifically have the REGULATOR role
test("non-regulators cannot administer stakeholders", async () => {
  const contract = new StakeholderRegistryContract();
  const stub = new MemoryStub();
  const regulatorContext = context(stub, "cert-regulator", REGULATOR_MSP_ID);

  await contract.bootstrapRegulator(regulatorContext, "regulator-001");
  await contract.registerStakeholder(
    regulatorContext,
    "farm-001",
    "FARM",
    "cert-farm"
  );

  const farmContext = context(stub, "cert-farm");
  await expectReject(
    contract.registerStakeholder(farmContext, "farm-002", "FARM", "cert-farm-2"),
    /Only an active REGULATOR/
  );
});

// assertActiveRole should approve the real caller with a permitted role and
// reject identity impersonation, the wrong role, and malformed role input
test("role assertion accepts only the authenticated, active caller with an allowed role", async () => {
  const contract = new StakeholderRegistryContract();
  const stub = new MemoryStub();
  const regulatorContext = context(stub, "cert-regulator", REGULATOR_MSP_ID);
  const farmContext = context(stub, "cert-farm");

  await contract.bootstrapRegulator(regulatorContext, "regulator-001");
  await contract.registerStakeholder(
    regulatorContext,
    "farm-001",
    "FARM",
    "cert-farm"
  );

  assert.deepEqual(
    JSON.parse(
      await contract.assertActiveRole(
        farmContext,
        "cert-farm",
        JSON.stringify(["FARM", "PROCESSOR"])
      )
    ),
    {
      stakeholderId: "farm-001",
      role: "FARM",
      active: true
    }
  );

  // A farm cannot pass the regulator's certificate and pretend to be the regulator
  await expectReject(
    contract.assertActiveRole(farmContext, "cert-regulator", '["REGULATOR"]'),
    /must match the authenticated transaction caller/
  );

  // A real farm still cannot perform an action reserved for logistics
  await expectReject(
    contract.assertActiveRole(farmContext, "cert-farm", '["LOGISTICS"]'),
    /requires one of: LOGISTICS/
  );

  // Cross-chaincode role input must be a valid JSON array
  await expectReject(
    contract.assertActiveRole(farmContext, "cert-farm", "not-json"),
    /valid JSON array/
  );
});

// Suspension should immediately fail future permission checks. Reactivation
// should restore access without creating a new stakeholder record
test("suspension blocks access, and reactivation restores it", async () => {
  const contract = new StakeholderRegistryContract();
  const stub = new MemoryStub();
  const regulatorContext = context(stub, "cert-regulator", REGULATOR_MSP_ID);
  const farmContext = context(stub, "cert-farm");

  await contract.bootstrapRegulator(regulatorContext, "regulator-001");
  await contract.registerStakeholder(
    regulatorContext,
    "farm-001",
    "FARM",
    "cert-farm"
  );
  await contract.suspendStakeholder(regulatorContext, "farm-001");

  await expectReject(
    contract.assertActiveRole(farmContext, "cert-farm", '["FARM"]'),
    /is suspended/
  );

  await contract.reactivateStakeholder(regulatorContext, "farm-001");
  const summary = JSON.parse(
    await contract.assertActiveRole(farmContext, "cert-farm", '["FARM"]')
  );
  assert.equal(summary.active, true);
});

// The registry must always keep at least one active regulator, otherwise nobody
// would remain able to register, suspend or reactivate stakeholders
test("the final active regulator cannot be suspended or lose its role", async () => {
  const contract = new StakeholderRegistryContract();
  const stub = new MemoryStub();
  const regulatorContext = context(stub, "cert-regulator", REGULATOR_MSP_ID);

  await contract.bootstrapRegulator(regulatorContext, "regulator-001");

  await expectReject(
    contract.suspendStakeholder(regulatorContext, "regulator-001"),
    /final active regulator/
  );
  await expectReject(
    contract.updateStakeholderRole(regulatorContext, "regulator-001", "FARM"),
    /final active regulator/
  );
});
