import assert from "node:assert/strict";
import test from "node:test";
import { getDemoIdentity, resolveDemoIdentity, DEMO_IDENTITY_HEADER } from "../dist/demoIdentity.js";

function requestWithHeader(value) {
  return {
    header: (name) => (name === DEMO_IDENTITY_HEADER ? value : undefined)
  };
}

// One certificate per role, so a batch's journey is signed by six different parties rather than
// a regulator handing its own identity around.
test("every role has an identity of its own", () => {
  const roles = ["regulator", "oracle", "farm", "retailer", "logistics", "processor"];
  const userPaths = roles.map((role) => getDemoIdentity(role).userPath);

  assert.equal(new Set(userPaths).size, roles.length, "two roles are sharing a certificate");
  assert.match(getDemoIdentity("farm").userPath, /org1\.example\.com\/users\/User2@/);
  assert.match(getDemoIdentity("processor").userPath, /org2\.example\.com\/users\/User2@/);
});

test("a known identity resolves to its organisation's wallet material", () => {
  const regulator = getDemoIdentity("regulator");
  // Org1 is the regulator organisation, and the registry only accepts that MSP for first setup.
  assert.equal(regulator.mspId, "Org1MSP");
  assert.equal(regulator.peerEndpoint, "localhost:7051");
  assert.equal(regulator.peerHostAlias, "peer0.org1.example.com");
  assert.match(regulator.userPath, /org1\.example\.com\/users\/Admin@org1\.example\.com\/msp$/);
  assert.match(regulator.peerTlsCaPath, /tlsca\.org1\.example\.com-cert\.pem$/);

  const logistics = getDemoIdentity("logistics");
  assert.equal(logistics.mspId, "Org2MSP");
  assert.equal(logistics.peerEndpoint, "localhost:9051");
});

test("identity names are matched regardless of spacing and case", () => {
  assert.deepEqual(getDemoIdentity("  REGULATOR "), getDemoIdentity("regulator"));
});

test("an unknown identity is refused and the message lists the valid ones", () => {
  assert.throws(() => getDemoIdentity("smuggler"), (error) => {
    assert.match(error.message, /Unknown demo identity 'smuggler'/);
    assert.match(error.message, /regulator/);
    return true;
  });
});

// A plain object lookup answers inherited keys from the prototype, and a truthy answer would slip
// past the unknown-identity guard and crash on the next line instead of naming the valid options.
test("an inherited property name is refused like any other unknown identity", () => {
  for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
    assert.throws(() => getDemoIdentity(name), (error) => {
      assert.match(error.message, /Unknown demo identity/);
      return true;
    }, `${name} should be refused`);
  }
});

test("a request without the identity header is refused", () => {
  assert.throws(
    () => resolveDemoIdentity(requestWithHeader(undefined)),
    new RegExp(`Missing ${DEMO_IDENTITY_HEADER} header`)
  );
});

test("the header selects which wallet identity signs", () => {
  assert.equal(resolveDemoIdentity(requestWithHeader("oracle")).name, "oracle");
  assert.equal(resolveDemoIdentity(requestWithHeader("retailer")).mspId, "Org2MSP");
});
