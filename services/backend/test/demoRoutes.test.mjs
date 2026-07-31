import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createDemoRouter } from "../dist/routes/demo.js";

function appWith(readCertificateId) {
  const app = express();
  app.use("/demo", createDemoRouter(readCertificateId));
  return app;
}

async function get(app, path) {
  const server = app.listen(0);
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`);
    return { status: response.status, body: await response.json() };
  } finally {
    server.close();
  }
}

test("every demo role is returned with the ID it registers under", async () => {
  const result = await get(
    appWith(async (identity) => `cert-for-${identity.name}`),
    "/demo/identities"
  );

  assert.equal(result.status, 200);
  assert.deepEqual(
    result.body.map((entry) => entry.role),
    ["regulator", "farm", "processor", "logistics", "retailer", "oracle"]
  );
  // The regulator is first because it must be bootstrapped before it can register anyone else.
  assert.deepEqual(result.body[0], {
    role: "regulator",
    stakeholderId: "regulator-001",
    certificateId: "cert-for-regulator"
  });
});

test("a stakeholder ID is supplied for every role", async () => {
  const result = await get(appWith(async () => "cert"), "/demo/identities");

  assert.equal(result.body.length, 6);
  for (const entry of result.body) {
    assert.match(entry.stakeholderId, /^[a-z]+-001$/, entry.role);
  }
});

test("an unreadable certificate fails the whole list rather than returning part of it", async () => {
  const result = await get(
    appWith(async (identity) => {
      if (identity.name === "oracle") {
        throw new Error("Expected exactly one file in signcerts, found 0.");
      }
      return "cert";
    }),
    "/demo/identities"
  );

  assert.equal(result.status, 500);
  assert.match(result.body.error, /certificates could not be read/);
});
