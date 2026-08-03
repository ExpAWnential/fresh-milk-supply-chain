import assert from "node:assert/strict";
import test from "node:test";
import { ORGANISATION_NAMES } from "../dist/organisations.js";
import { withServer } from "./harness.mjs";

const asRetailer = {
  identity: {
    name: "retailer",
    mspId: "RetailerMSP",
    peerEndpoint: "localhost:11051",
    stakeholderId: "retailer-001",
    backendPort: 3005
  },
  certificateId: "x509::CN=User1@retailer.example.com::CN=ca.retailer.example.com"
};

test("a backend describes itself, including the certificate it signs with", async () => {
  await withServer(asRetailer, async ({ call }) => {
    const result = await call("GET", "/identity");

    assert.equal(result.status, 200);
    assert.deepEqual(result.body, {
      name: "retailer",
      mspId: "RetailerMSP",
      peerEndpoint: "localhost:11051",
      stakeholderId: "retailer-001",
      origin: "http://localhost:3005",
      certificateId: asRetailer.certificateId
    });
  });
});

// A process holds one certificate and reports only that one. The page collects the six by asking
// each company in turn, which is what stops any single process reading everyone else's wallet.
test("a backend reports no certificate but its own", async () => {
  await withServer(asRetailer, async ({ call }) => {
    const result = await call("GET", "/identity");
    assert.equal(Object.keys(result.body).filter((key) => key.includes("ertificate")).length, 1);
  });
});

test("the directory lists all six companies and where to reach them", async () => {
  await withServer(asRetailer, async ({ call }) => {
    const result = await call("GET", "/organisations");

    assert.equal(result.status, 200);
    assert.deepEqual(result.body.map((entry) => entry.name), ORGANISATION_NAMES);
    assert.deepEqual(
      result.body.map((entry) => entry.origin),
      [3001, 3002, 3003, 3004, 3005, 3006].map((port) => `http://localhost:${port}`)
    );
  });
});

// The page is served by one company's backend but has to reach all six, so the directory cannot
// depend on which one answered.
test("the directory is the same whichever company is asked", async () => {
  let fromRetailer;
  await withServer(asRetailer, async ({ call }) => {
    fromRetailer = (await call("GET", "/organisations")).body;
  });

  await withServer(
    { ...asRetailer, identity: { ...asRetailer.identity, name: "farm", backendPort: 3002 } },
    async ({ call }) => {
      assert.deepEqual((await call("GET", "/organisations")).body, fromRetailer);
    }
  );
});

// Nothing here should carry a private key, a path on disk, or anything a company would not publish
// to the others.
test("the directory publishes nothing beyond what a company would tell the consortium", async () => {
  await withServer(asRetailer, async ({ call }) => {
    const result = await call("GET", "/organisations");

    for (const entry of result.body) {
      assert.deepEqual(Object.keys(entry).sort(), [
        "mspId",
        "name",
        "origin",
        "peerEndpoint",
        "stakeholderId"
      ]);
    }
  });
});
