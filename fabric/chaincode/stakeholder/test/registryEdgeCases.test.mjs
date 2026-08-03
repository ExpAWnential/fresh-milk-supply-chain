import assert from "node:assert/strict";
import test from "node:test";
import {
  REGULATOR_MSP_ID,
  StakeholderRegistryContract
} from "../dist/contracts/StakeholderRegistryContract.js";
import { getInvokingIdentity } from "../dist/utils/identity.js";
import { getTransactionMetadata } from "../dist/utils/txContext.js";
import { MemoryStub, context } from "./fabricStub.mjs";

async function registryWithRegulator() {
  const contract = new StakeholderRegistryContract();
  const stub = new MemoryStub();
  const regulator = context(stub, "cert-regulator", REGULATOR_MSP_ID);
  await contract.bootstrapRegulator(regulator, "regulator-001");
  return { contract, stub, regulator };
}

test("stakeholder IDs, roles and certificates must not be blank", async () => {
  const { contract, regulator } = await registryWithRegulator();

  await assert.rejects(
    contract.registerStakeholder(regulator, "   ", "FARM", "cert-farm"),
    /Stakeholder ID must not be empty/
  );
  await assert.rejects(
    contract.registerStakeholder(regulator, "farm-001", "  ", "cert-farm"),
    /Role must not be empty/
  );
  await assert.rejects(
    contract.registerStakeholder(regulator, "farm-001", "FARM", "   "),
    /Certificate ID must not be empty/
  );
});

test("role assertion rejects malformed role lists", async () => {
  const { contract, stub, regulator } = await registryWithRegulator();
  await contract.registerStakeholder(regulator, "farm-001", "FARM", "cert-farm");
  const farm = context(stub, "cert-farm");

  for (const [roles, expected] of [
    ["[]", /non-empty JSON array/],
    ['"FARM"', /non-empty JSON array/],
    ["[123]", /Every allowed role must be a string/],
    ['["WIZARD"]', /Invalid stakeholder role/]
  ]) {
    await assert.rejects(contract.assertActiveRole(farm, "cert-farm", roles), expected);
  }
});

test("an unregistered certificate is refused everywhere it is used", async () => {
  const { contract, stub } = await registryWithRegulator();
  const stranger = context(stub, "cert-stranger");

  await assert.rejects(
    contract.assertActiveRole(stranger, "cert-stranger", '["FARM"]'),
    /not registered to a stakeholder/
  );
  await assert.rejects(
    contract.registerStakeholder(stranger, "farm-002", "FARM", "cert-other"),
    /not registered to a stakeholder/
  );
  await assert.rejects(contract.getStakeholder(stranger, "regulator-001"), /not registered/);
});

test("a suspended regulator can no longer administer or read the registry", async () => {
  const { contract, stub, regulator } = await registryWithRegulator();
  await contract.registerStakeholder(regulator, "regulator-002", "REGULATOR", "cert-regulator-2");
  await contract.suspendStakeholder(regulator, "regulator-002");

  const suspended = context(stub, "cert-regulator-2");
  await assert.rejects(
    contract.registerStakeholder(suspended, "farm-001", "FARM", "cert-farm"),
    /is suspended/
  );
  await assert.rejects(contract.getStakeholder(suspended, "regulator-001"), /is suspended/);
});

test("suspending and reactivating are refused when they would change nothing", async () => {
  const { contract, regulator } = await registryWithRegulator();
  await contract.registerStakeholder(regulator, "farm-001", "FARM", "cert-farm");

  await assert.rejects(contract.reactivateStakeholder(regulator, "farm-001"), /already active/);
  await contract.suspendStakeholder(regulator, "farm-001");
  await assert.rejects(contract.suspendStakeholder(regulator, "farm-001"), /already suspended/);
});

test("a role change to the role already held is refused", async () => {
  const { contract, regulator } = await registryWithRegulator();
  await contract.registerStakeholder(regulator, "farm-001", "FARM", "cert-farm");

  await assert.rejects(
    contract.updateStakeholderRole(regulator, "farm-001", "farm"),
    /already has role 'FARM'/
  );
});

// Regulator count changes must never leave the registry without an administrator.
test("the regulator count follows promotions, demotions and suspensions", async () => {
  const { contract, stub, regulator } = await registryWithRegulator();
  await contract.registerStakeholder(regulator, "farm-001", "FARM", "cert-farm");

  await assert.rejects(
    contract.updateStakeholderRole(regulator, "regulator-001", "FARM"),
    /final active regulator/
  );

  await contract.updateStakeholderRole(regulator, "farm-001", "REGULATOR");
  await contract.updateStakeholderRole(regulator, "regulator-001", "FARM");

  const promoted = context(stub, "cert-farm");
  const demoted = JSON.parse(await contract.getStakeholder(promoted, "regulator-001"));
  assert.equal(demoted.role, "FARM");

  await assert.rejects(
    contract.suspendStakeholder(promoted, "farm-001"),
    /final active regulator/
  );
});

test("a suspended regulator does not count towards the minimum", async () => {
  const { contract, regulator } = await registryWithRegulator();
  await contract.registerStakeholder(regulator, "regulator-002", "REGULATOR", "cert-regulator-2");
  await contract.suspendStakeholder(regulator, "regulator-002");

  await assert.rejects(
    contract.suspendStakeholder(regulator, "regulator-001"),
    /final active regulator/
  );
});

// Reactivation restores the active-regulator count.
test("reactivating a regulator puts it back into the count", async () => {
  const { contract, regulator } = await registryWithRegulator();
  await contract.registerStakeholder(regulator, "regulator-002", "REGULATOR", "cert-regulator-2");
  await contract.suspendStakeholder(regulator, "regulator-002");

  await assert.rejects(
    contract.suspendStakeholder(regulator, "regulator-001"),
    /final active regulator/
  );

  await contract.reactivateStakeholder(regulator, "regulator-002");

  await contract.suspendStakeholder(regulator, "regulator-001");
});

// Reactivating a non-regulator must not change the regulator count.
test("reactivating anyone else leaves the regulator count where it was", async () => {
  const { contract, regulator } = await registryWithRegulator();
  await contract.registerStakeholder(regulator, "farm-001", "FARM", "cert-farm");
  await contract.suspendStakeholder(regulator, "farm-001");
  await contract.reactivateStakeholder(regulator, "farm-001");

  await assert.rejects(
    contract.suspendStakeholder(regulator, "regulator-001"),
    /final active regulator/
  );
});

// Distinguish an unknown subject ID from an unknown caller certificate.
test("an operation on a stakeholder that does not exist names the one it looked for", async () => {
  const { contract, regulator } = await registryWithRegulator();

  for (const operation of [
    () => contract.getStakeholder(regulator, "farm-404"),
    () => contract.updateStakeholderRole(regulator, "farm-404", "PROCESSOR"),
    () => contract.suspendStakeholder(regulator, "farm-404"),
    () => contract.reactivateStakeholder(regulator, "farm-404")
  ]) {
    await assert.rejects(operation(), /Stakeholder 'farm-404' does not exist/);
  }
});

const COUNT_KEY = "registry.activeRegulatorCount";

// Missing or corrupt regulator counts cannot be used for lockout decisions.
test("an uninitialised registry is reported rather than treated as having no regulators", async () => {
  const { contract, stub, regulator } = await registryWithRegulator();
  await contract.registerStakeholder(regulator, "regulator-002", "REGULATOR", "cert-regulator-2");
  stub.state.delete(COUNT_KEY);

  await assert.rejects(
    contract.suspendStakeholder(regulator, "regulator-002"),
    /has not been initialised/
  );
});

test("a counter that could not have been written by this contract is refused", async () => {
  for (const stored of ["0", "-1", "not a number", "1.5", ""]) {
    const { contract, stub, regulator } = await registryWithRegulator();
    await contract.registerStakeholder(regulator, "regulator-002", "REGULATOR", "cert-regulator-2");
    stub.state.set(COUNT_KEY, Buffer.from(stored));

    await assert.rejects(
      contract.suspendStakeholder(regulator, "regulator-002"),
      /has not been initialised|count stored on the ledger is invalid/,
      JSON.stringify(stored)
    );
  }
});

test("every stakeholder record carries who created it, when, and in which transaction", async () => {
  const { contract, regulator } = await registryWithRegulator();
  await contract.registerStakeholder(regulator, "farm-001", "FARM", "cert-farm");

  const farm = JSON.parse(await contract.getStakeholder(regulator, "farm-001"));
  assert.equal(farm.createdByCertificateId, "cert-regulator");
  assert.equal(farm.createdTxId, "tx-1");
  assert.equal(farm.createdAt, new Date(1_750_000_001_123).toISOString());
  assert.equal(farm.updatedTxId, farm.createdTxId);
});

test("identity and metadata refuse values Fabric could not supply", () => {
  const stub = new MemoryStub();
  assert.throws(() => getInvokingIdentity(context(stub, "  ")), /certificate ID/);
  assert.throws(() => getInvokingIdentity(context(stub, "cert", "  ")), /MSP ID/);

  const broken = context(stub, "cert-regulator", REGULATOR_MSP_ID);
  broken.stub = { ...stub, getTxTimestamp: () => ({ seconds: Number.NaN, nanos: 0 }) };
  assert.throws(() => getTransactionMetadata(broken), /invalid transaction timestamp/);

  const noTxId = context(stub, "cert-regulator", REGULATOR_MSP_ID);
  noTxId.stub = { ...stub, getTxID: () => "   ", getTxTimestamp: () => stub.getTxTimestamp() };
  assert.throws(() => getTransactionMetadata(noTxId), /empty transaction ID/);

  const outOfRange = context(stub, "cert-regulator", REGULATOR_MSP_ID);
  outOfRange.stub = { ...stub, getTxTimestamp: () => ({ seconds: 1e15, nanos: 0 }) };
  assert.throws(() => getTransactionMetadata(outOfRange), /invalid transaction timestamp/);
});
