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

// Bootstrap trusts the regulator MSP and can succeed only once.
test("only the regulator MSP can bootstrap the registry, and only once", async () => {
  const contract = new StakeholderRegistryContract();
  const stub = new MemoryStub();

  await expectReject(
    contract.bootstrapRegulator(context(stub, "cert-attacker"), "attacker"),
    new RegExp(`Only a member of MSP '${REGULATOR_MSP_ID}'`)
  );

  const regulatorContext = context(stub, "cert-regulator", REGULATOR_MSP_ID);
  await contract.bootstrapRegulator(regulatorContext, "regulator-001");

  const regulator = JSON.parse(await contract.getStakeholder(regulatorContext, "regulator-001"));
  assert.equal(regulator.role, "REGULATOR");
  assert.equal(regulator.certificateId, "cert-regulator");
  assert.equal(regulator.active, true);
  assert.equal(regulator.createdTxId, "tx-1");

  await expectReject(
    contract.bootstrapRegulator(regulatorContext, "regulator-002"),
    /already been initialised/
  );
});

// Registration requires an active regulator and valid unique identity fields.
test("an active regulator can register stakeholders and duplicates are rejected", async () => {
  const contract = new StakeholderRegistryContract();
  const stub = new MemoryStub();
  const regulatorContext = context(stub, "cert-regulator", REGULATOR_MSP_ID);

  await contract.bootstrapRegulator(regulatorContext, "regulator-001");
  await contract.registerStakeholder(regulatorContext, "farm-001", "farm", "cert-farm");

  const farm = JSON.parse(await contract.getStakeholder(regulatorContext, "farm-001"));
  assert.equal(farm.role, "FARM");
  assert.equal(farm.active, true);

  await expectReject(
    contract.registerStakeholder(regulatorContext, "farm-001", "FARM", "cert-other"),
    /already exists/
  );

  await expectReject(
    contract.registerStakeholder(regulatorContext, "farm-002", "FARM", "cert-farm"),
    /certificate ID is already registered/
  );

  await expectReject(
    contract.registerStakeholder(regulatorContext, "farm-002", "UNKNOWN", "cert-other"),
    /Invalid stakeholder role/
  );
});

// Registry administration requires the regulator role.
test("non-regulators cannot administer stakeholders", async () => {
  const contract = new StakeholderRegistryContract();
  const stub = new MemoryStub();
  const regulatorContext = context(stub, "cert-regulator", REGULATOR_MSP_ID);

  await contract.bootstrapRegulator(regulatorContext, "regulator-001");
  await contract.registerStakeholder(regulatorContext, "farm-001", "FARM", "cert-farm");

  const farmContext = context(stub, "cert-farm");
  await expectReject(
    contract.registerStakeholder(farmContext, "farm-002", "FARM", "cert-farm-2"),
    /Only an active REGULATOR/
  );
});

// Cross-chaincode authorisation binds the allowed role to the authenticated certificate.
test("role assertion accepts only the authenticated, active caller with an allowed role", async () => {
  const contract = new StakeholderRegistryContract();
  const stub = new MemoryStub();
  const regulatorContext = context(stub, "cert-regulator", REGULATOR_MSP_ID);
  const farmContext = context(stub, "cert-farm");

  await contract.bootstrapRegulator(regulatorContext, "regulator-001");
  await contract.registerStakeholder(regulatorContext, "farm-001", "FARM", "cert-farm");

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

  await expectReject(
    contract.assertActiveRole(farmContext, "cert-regulator", '["REGULATOR"]'),
    /must match the authenticated transaction caller/
  );

  await expectReject(
    contract.assertActiveRole(farmContext, "cert-farm", '["LOGISTICS"]'),
    /requires one of: LOGISTICS/
  );

  await expectReject(
    contract.assertActiveRole(farmContext, "cert-farm", "not-json"),
    /valid JSON array/
  );
});

// Suspension removes access and reactivation restores the same stakeholder record.
test("suspension blocks access, and reactivation restores it", async () => {
  const contract = new StakeholderRegistryContract();
  const stub = new MemoryStub();
  const regulatorContext = context(stub, "cert-regulator", REGULATOR_MSP_ID);
  const farmContext = context(stub, "cert-farm");

  await contract.bootstrapRegulator(regulatorContext, "regulator-001");
  await contract.registerStakeholder(regulatorContext, "farm-001", "FARM", "cert-farm");
  await contract.suspendStakeholder(regulatorContext, "farm-001");

  await expectReject(
    contract.assertActiveRole(farmContext, "cert-farm", '["FARM"]'),
    /is suspended/
  );

  await contract.reactivateStakeholder(regulatorContext, "farm-001");
  const summary = JSON.parse(await contract.assertActiveRole(farmContext, "cert-farm", '["FARM"]'));
  assert.equal(summary.active, true);
});

// The active-regulator guard prevents administrative lockout.
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

// Real Ed25519 DER SPKI key matching the signing script's output format.
const SENSOR_PUBLIC_KEY = "MCowBQYDK2VwAyEAGb9ECWmEzf6FQbrBZ9w7lshQhqowtrbLDpp7XFKhwuk=";

// Sensor key registration is a regulator attestation available to every verifier.
test("only an active regulator can vouch for a sensor's key", async () => {
  const contract = new StakeholderRegistryContract();
  const stub = new MemoryStub();
  const regulatorContext = context(stub, "cert-regulator", REGULATOR_MSP_ID);

  await contract.bootstrapRegulator(regulatorContext, "regulator-001");
  await contract.registerStakeholder(regulatorContext, "farm-001", "FARM", "cert-farm");

  await contract.registerSensorKey(regulatorContext, "SENSOR-001", SENSOR_PUBLIC_KEY, "ed25519");

  const stored = JSON.parse(await contract.getSensorKey(regulatorContext, "SENSOR-001"));
  assert.equal(stored.publicKey, SENSOR_PUBLIC_KEY);
  assert.equal(stored.algorithm, "ed25519");
  assert.equal(stored.active, true);
  assert.equal(stored.registeredByStakeholderId, "regulator-001");
  assert.equal(stub.events.at(-1).name, "SensorKeyRegistered");

  await expectReject(
    contract.registerSensorKey(
      context(stub, "cert-farm"),
      "SENSOR-002",
      SENSOR_PUBLIC_KEY,
      "ed25519"
    ),
    /Only an active REGULATOR/
  );

  const asFarm = JSON.parse(await contract.getSensorKey(context(stub, "cert-farm"), "SENSOR-001"));
  assert.equal(asFarm.publicKey, SENSOR_PUBLIC_KEY);

  await expectReject(
    contract.getSensorKey(context(stub, "cert-stranger"), "SENSOR-001"),
    /not registered to a stakeholder/
  );
});

// Key replacement requires an explicit lifecycle rather than silent overwrite.
test("a sensor key cannot be quietly replaced, and a bad key is refused outright", async () => {
  const contract = new StakeholderRegistryContract();
  const stub = new MemoryStub();
  const regulatorContext = context(stub, "cert-regulator", REGULATOR_MSP_ID);

  await contract.bootstrapRegulator(regulatorContext, "regulator-001");
  await contract.registerSensorKey(regulatorContext, "SENSOR-001", SENSOR_PUBLIC_KEY, "ed25519");

  await expectReject(
    contract.registerSensorKey(regulatorContext, "SENSOR-001", SENSOR_PUBLIC_KEY, "ed25519"),
    /already has a registered key/
  );

  await expectReject(
    contract.registerSensorKey(regulatorContext, "SENSOR-BAD", "not a key at all!", "ed25519"),
    /base64 with no stray characters/
  );
  await expectReject(
    contract.registerSensorKey(regulatorContext, "SENSOR-BAD", "c2hvcnQ=", "ed25519"),
    /must be 44 bytes in DER SPKI form/
  );
  await expectReject(
    contract.registerSensorKey(regulatorContext, "SENSOR-BAD", SENSOR_PUBLIC_KEY, "rsa"),
    /Invalid signature algorithm/
  );
  await expectReject(
    contract.registerSensorKey(regulatorContext, "  ", SENSOR_PUBLIC_KEY, "ed25519"),
    /Sensor ID must not be empty/
  );
});

// Revocation preserves the key's audit record.
test("a regulator can revoke a sensor key, and the record survives revocation", async () => {
  const contract = new StakeholderRegistryContract();
  const stub = new MemoryStub();
  const regulatorContext = context(stub, "cert-regulator", REGULATOR_MSP_ID);

  await contract.bootstrapRegulator(regulatorContext, "regulator-001");
  await contract.registerSensorKey(regulatorContext, "SENSOR-001", SENSOR_PUBLIC_KEY, "ed25519");

  stub.txNumber = 2;
  await contract.revokeSensorKey(regulatorContext, "SENSOR-001");

  const revoked = JSON.parse(await contract.getSensorKey(regulatorContext, "SENSOR-001"));
  assert.equal(revoked.active, false);
  assert.equal(revoked.publicKey, SENSOR_PUBLIC_KEY, "the key itself is kept, only disowned");
  assert.equal(revoked.registeredTxId, "tx-1", "who first vouched for it is still on the record");
  assert.equal(revoked.updatedTxId, "tx-2", "and the revocation is stamped separately");
  assert.equal(stub.events.at(-1).name, "SensorKeyRevoked");

  await expectReject(contract.revokeSensorKey(regulatorContext, "SENSOR-001"), /already revoked/);
  await expectReject(
    contract.getSensorKey(regulatorContext, "SENSOR-404"),
    /Sensor 'SENSOR-404' has no registered key/
  );
});
