import assert from "node:assert/strict";
import test from "node:test";
import { getDemoIdentity, resolveDemoIdentity, DEMO_IDENTITY_HEADER } from "../dist/demoIdentity.js";

function requestWithHeader(value) {
  return {
    header: (name) => (name === DEMO_IDENTITY_HEADER ? value : undefined)
  };
}

const ROLES = ["regulator", "oracle", "farm", "retailer", "logistics", "processor"];

// One organisation per role, so no certificate authority issues identities for a company it has no
// relationship with, and an endorsement policy can name a single role.
test("every role has an organisation, a certificate and a peer of its own", () => {
  const identities = ROLES.map(getDemoIdentity);

  assert.equal(
    new Set(identities.map((identity) => identity.mspId)).size,
    ROLES.length,
    "two roles are sharing an organisation"
  );
  assert.equal(
    new Set(identities.map((identity) => identity.userPath)).size,
    ROLES.length,
    "two roles are sharing a certificate"
  );
  assert.equal(
    new Set(identities.map((identity) => identity.peerEndpoint)).size,
    ROLES.length,
    "two roles are sharing a peer"
  );
});

test("a known identity resolves to its organisation's wallet material", () => {
  const regulator = getDemoIdentity("regulator");
  assert.equal(regulator.mspId, "RegulatorMSP");
  assert.equal(regulator.peerEndpoint, "localhost:7051");
  assert.equal(regulator.peerHostAlias, "peer0.regulator.example.com");
  // User1 rather than Admin: no demo role should be carrying channel-administration authority.
  assert.match(regulator.userPath, /regulator\.example\.com\/users\/User1@regulator\.example\.com\/msp$/);
  assert.match(regulator.peerTlsCaPath, /tlsca\.regulator\.example\.com-cert\.pem$/);

  const logistics = getDemoIdentity("logistics");
  assert.equal(logistics.mspId, "LogisticsMSP");
  assert.equal(logistics.peerEndpoint, "localhost:10051");
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
  assert.equal(resolveDemoIdentity(requestWithHeader("retailer")).mspId, "RetailerMSP");
});
