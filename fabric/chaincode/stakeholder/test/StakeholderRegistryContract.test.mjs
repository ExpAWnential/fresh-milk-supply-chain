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

  // A caller from any other organisation must not become the first regulator. Matched against the
  // exported constant rather than a literal, so renaming the regulator's organisation cannot leave
  // this asserting on a name nothing uses.
  await expectReject(
    contract.bootstrapRegulator(context(stub, "cert-attacker"), "attacker"),
    new RegExp(`Only a member of MSP '${REGULATOR_MSP_ID}'`)
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

// A real Ed25519 public key in DER SPKI form. Generated once and pasted rather than produced at
// test time, so the validation is exercised against the exact shape the signing script emits.
const SENSOR_PUBLIC_KEY = "MCowBQYDK2VwAyEAGb9ECWmEzf6FQbrBZ9w7lshQhqowtrbLDpp7XFKhwuk=";

// Registering a sensor's public key is what makes the oracle a courier rather than a witness: it
// relays readings it cannot forge, because it never holds the private half. That attestation is
// the regulator's to make, which is why it lives in this contract at all.
test("only an active regulator can vouch for a sensor's key", async () => {
  const contract = new StakeholderRegistryContract();
  const stub = new MemoryStub();
  const regulatorContext = context(stub, "cert-regulator", REGULATOR_MSP_ID);

  await contract.bootstrapRegulator(regulatorContext, "regulator-001");
  await contract.registerStakeholder(regulatorContext, "farm-001", "FARM", "cert-farm");

  await contract.registerSensorKey(
    regulatorContext,
    "SENSOR-001",
    SENSOR_PUBLIC_KEY,
    "ed25519"
  );

  const stored = JSON.parse(await contract.getSensorKey(regulatorContext, "SENSOR-001"));
  assert.equal(stored.publicKey, SENSOR_PUBLIC_KEY);
  assert.equal(stored.algorithm, "ed25519");
  assert.equal(stored.active, true);
  assert.equal(stored.registeredByStakeholderId, "regulator-001");
  assert.equal(stub.events.at(-1).name, "SensorKeyRegistered");

  // A company that is not the regulator has no business attesting to whose sensor is whose.
  await expectReject(
    contract.registerSensorKey(
      context(stub, "cert-farm"),
      "SENSOR-002",
      SENSOR_PUBLIC_KEY,
      "ed25519"
    ),
    /Only an active REGULATOR/
  );

  // Any registered participant may read it. The key is public: it can check a signature and never
  // produce one, so withholding it would only stop honest parties verifying.
  const asFarm = JSON.parse(await contract.getSensorKey(context(stub, "cert-farm"), "SENSOR-001"));
  assert.equal(asFarm.publicKey, SENSOR_PUBLIC_KEY);

  await expectReject(
    contract.getSensorKey(context(stub, "cert-stranger"), "SENSOR-001"),
    /not registered to a stakeholder/
  );
});

// Silently replacing a key would retire every signature made under the old one with no trace, so
// a second registration has to be refused rather than overwrite.
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

  // Buffer.from ignores characters outside the base64 alphabet, so a typo decodes to something
  // shorter instead of failing. Without the round-trip check these would all store happily and
  // then fail to verify anything, months later, against a record the regulator believes is right.
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

// A compromised sensor has to be disownable. The record stays rather than being deleted, so
// readings signed before the revocation can still be told apart from readings signed after it.
test("a regulator can revoke a sensor key, and the record survives revocation", async () => {
  const contract = new StakeholderRegistryContract();
  const stub = new MemoryStub();
  const regulatorContext = context(stub, "cert-regulator", REGULATOR_MSP_ID);

  await contract.bootstrapRegulator(regulatorContext, "regulator-001");
  await contract.registerSensorKey(regulatorContext, "SENSOR-001", SENSOR_PUBLIC_KEY, "ed25519");

  // The stub reuses one transaction ID until it is moved on. Advancing it here is what makes the
  // audit assertion below mean anything, since otherwise both stamps would match by default.
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
