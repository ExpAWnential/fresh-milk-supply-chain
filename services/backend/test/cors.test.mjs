import assert from "node:assert/strict";
import test from "node:test";
import { stubLedger, withServer } from "./harness.mjs";

// The control panel must call all six organisation backends from one browser origin.
const RETAILER = "http://localhost:3005";

async function request(base, method, path, headers) {
  const response = await fetch(base + path, { method, headers });
  await response.text();
  return response;
}

test("a request from another company's backend is allowed", async () => {
  await withServer({}, async ({ base }) => {
    const response = await request(base, "GET", "/health", { origin: RETAILER });
    assert.equal(response.headers.get("access-control-allow-origin"), RETAILER);
  });
});

test("a request from anywhere else is not allowed", async () => {
  await withServer({}, async ({ base }) => {
    for (const origin of ["http://localhost:9999", "https://example.com", "null"]) {
      const response = await request(base, "GET", "/health", { origin });
      assert.equal(response.headers.get("access-control-allow-origin"), null, origin);
    }
  });
});

test("the response varies by origin", async () => {
  await withServer({}, async ({ base }) => {
    const response = await request(base, "GET", "/health", { origin: RETAILER });
    assert.match(response.headers.get("vary") ?? "", /Origin/i);
  });
});

test("a preflight for a JSON write is answered", async () => {
  await withServer({}, async ({ base }) => {
    const response = await request(base, "OPTIONS", "/stakeholders", {
      origin: RETAILER,
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type"
    });

    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), RETAILER);
    assert.match(response.headers.get("access-control-allow-methods") ?? "", /POST/);
    assert.match(response.headers.get("access-control-allow-methods") ?? "", /PATCH/);
    assert.match(response.headers.get("access-control-allow-headers") ?? "", /content-type/i);
  });
});

test("credentials are never allowed", async () => {
  await withServer({}, async ({ base }) => {
    for (const method of ["GET", "OPTIONS"]) {
      const response = await request(base, method, "/health", { origin: RETAILER });
      assert.equal(response.headers.get("access-control-allow-credentials"), null, method);
    }
  });
});

test("a write from an unknown origin is refused, not merely made unreadable", async () => {
  const ledger = stubLedger();
  await withServer({ ledger }, async ({ base }) => {
    const response = await request(base, "POST", "/stakeholders/farm-001/suspend", {
      origin: "https://evil.example.com"
    });

    assert.equal(response.status, 403);
  });

  assert.deepEqual(ledger.calls, []);
});

test("a write from one of the six companies is allowed through", async () => {
  const ledger = stubLedger();
  await withServer({ ledger }, async ({ base }) => {
    const response = await request(base, "POST", "/stakeholders/farm-001/suspend", {
      origin: RETAILER
    });

    assert.equal(response.status, 200);
  });

  assert.equal(ledger.calls.length, 1);
});

test("a write with no origin header is left alone", async () => {
  const ledger = stubLedger();
  await withServer({ ledger }, async ({ base }) => {
    const response = await request(base, "POST", "/stakeholders/farm-001/suspend", {});
    assert.equal(response.status, 200);
  });

  assert.equal(ledger.calls.length, 1);
});

test("the loopback address is accepted in either spelling", async () => {
  await withServer({}, async ({ base }) => {
    for (const origin of ["http://localhost:3005", "http://127.0.0.1:3005"]) {
      const response = await request(base, "GET", "/health", { origin });
      assert.equal(response.headers.get("access-control-allow-origin"), origin, origin);
    }
  });
});
