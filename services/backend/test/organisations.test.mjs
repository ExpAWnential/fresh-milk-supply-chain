import assert from "node:assert/strict";
import test from "node:test";
import {
  ORGANISATIONS,
  ORGANISATION_NAMES,
  findOrganisation,
  originOf,
  readingsHolder,
  resolveLocalOrganisation,
  walletFor
} from "../dist/organisations.js";

const WALLET_ROOT = "/tmp/organizations";
const wallet = (name) => walletFor(findOrganisation(name), WALLET_ROOT);

// One organisation per company, so no certificate authority issues identities for a company it has
// no relationship with, and an endorsement policy can name a single role.
test("every company has an organisation, a certificate, a peer and a port of its own", () => {
  const identities = ORGANISATION_NAMES.map(wallet);
  const distinct = (field) => new Set(identities.map((identity) => identity[field])).size;

  assert.equal(distinct("mspId"), ORGANISATION_NAMES.length, "two companies share an organisation");
  assert.equal(distinct("userPath"), ORGANISATION_NAMES.length, "two companies share a certificate");
  assert.equal(distinct("peerEndpoint"), ORGANISATION_NAMES.length, "two companies share a peer");
  assert.equal(distinct("backendPort"), ORGANISATION_NAMES.length, "two backends share a port");
  assert.equal(
    distinct("stakeholderId"),
    ORGANISATION_NAMES.length,
    "two companies share a stakeholder ID"
  );
});

// The regulator has to be bootstrapped before it can register anybody, so the page walks this list
// in order when setting the demo up.
test("the six companies are listed with the regulator first", () => {
  assert.deepEqual(ORGANISATION_NAMES, [
    "regulator",
    "farm",
    "processor",
    "logistics",
    "retailer",
    "oracle"
  ]);
});

test("the backend ports run 3001 to 3006 in that order", () => {
  assert.deepEqual(
    ORGANISATIONS.map((organisation) => organisation.backendPort),
    [3001, 3002, 3003, 3004, 3005, 3006]
  );
});

test("a known company resolves to its own wallet material", () => {
  const regulator = wallet("regulator");
  assert.equal(regulator.mspId, "RegulatorMSP");
  assert.equal(regulator.peerEndpoint, "localhost:7051");
  assert.equal(regulator.peerHostAlias, "peer0.regulator.example.com");
  // User1 rather than Admin: no company's ordinary traffic should carry channel-admin authority.
  assert.match(
    regulator.userPath,
    /regulator\.example\.com\/users\/User1@regulator\.example\.com\/msp$/
  );
  assert.match(regulator.peerTlsCaPath, /tlsca\.regulator\.example\.com-cert\.pem$/);

  const logistics = wallet("logistics");
  assert.equal(logistics.mspId, "LogisticsMSP");
  assert.equal(logistics.peerEndpoint, "localhost:10051");
});

test("company names are matched regardless of spacing and case", () => {
  assert.deepEqual(findOrganisation("  REGULATOR "), findOrganisation("regulator"));
});

test("an unknown company is refused and the message lists the valid ones", () => {
  assert.throws(() => findOrganisation("smuggler"), (error) => {
    assert.match(error.message, /Unknown organisation 'smuggler'/);
    assert.match(error.message, /regulator/);
    return true;
  });
});

// A plain object lookup answers inherited keys from the prototype, and a truthy answer would slip
// past the unknown-company guard and crash on the next line instead of naming the valid options.
test("an inherited property name is refused like any other unknown company", () => {
  for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
    assert.throws(() => findOrganisation(name), (error) => {
      assert.match(error.message, /Unknown organisation/);
      return true;
    }, `${name} should be refused`);
  }
});

// Which company a process acts for is the one thing it cannot be wrong about: it decides which
// private key signs every transaction the process makes.
test("a process with no ORGANISATION set is refused, and told the six valid names", () => {
  assert.throws(() => resolveLocalOrganisation({}, WALLET_ROOT), (error) => {
    assert.match(error.message, /Set ORGANISATION/);
    for (const name of ORGANISATION_NAMES) {
      assert.match(error.message, new RegExp(name));
    }
    return true;
  });

  assert.throws(() => resolveLocalOrganisation({ ORGANISATION: "   " }, WALLET_ROOT), /Set ORGANISATION/);
});

test("a process with an unknown ORGANISATION is refused", () => {
  assert.throws(
    () => resolveLocalOrganisation({ ORGANISATION: "smuggler" }, WALLET_ROOT),
    /Unknown organisation 'smuggler'/
  );
});

// Two callers have to agree on this: one builds the CORS allowlist and the other builds the
// directory the demo page dials. If they ever disagreed, every cross-company call would be rejected
// by the browser and reported as the backend being down, which names nothing.
test("a company's origin is built from its own port, in one place", () => {
  assert.equal(originOf(findOrganisation("regulator")), "http://localhost:3001");
  assert.equal(originOf(findOrganisation("oracle")), "http://localhost:3006");
});

// The one company the other five have to be able to find: everyone else fetches the readings from
// it to run their own verification.
test("the readings are held by the oracle", () => {
  assert.equal(readingsHolder().name, "oracle");
  assert.equal(readingsHolder().offChainStore, "readings");
});

// What a company keeps off-chain is declared in this table rather than decided by name at each
// wiring point, and the two stores are separate databases holding different things.
test("only the oracle and the regulator keep anything off-chain, and not the same thing", () => {
  const stores = ORGANISATIONS.filter((organisation) => organisation.offChainStore);

  assert.deepEqual(
    stores.map((organisation) => [organisation.name, organisation.offChainStore]),
    [
      ["regulator", "verdicts"],
      ["oracle", "readings"]
    ]
  );
});

test("ORGANISATION picks the wallet the process signs with", () => {
  const oracle = resolveLocalOrganisation({ ORGANISATION: "oracle" }, WALLET_ROOT);
  assert.equal(oracle.name, "oracle");
  assert.equal(oracle.mspId, "OracleMSP");
  assert.equal(oracle.backendPort, 3006);
});
