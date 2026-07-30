import assert from "node:assert/strict";
import test from "node:test";
import { getDemoIdentity, resolveDemoIdentity, DEMO_IDENTITY_HEADER } from "../dist/demoIdentity.js";

function requestWithHeader(value) {
  return {
    header: (name) => (name === DEMO_IDENTITY_HEADER ? value : undefined)
  };
}

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
