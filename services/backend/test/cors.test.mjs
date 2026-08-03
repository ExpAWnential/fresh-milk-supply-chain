import assert from "node:assert/strict";
import test from "node:test";
import { stubLedger, withServer } from "./harness.mjs";

// The demo page is served by one company's backend and drives all six, so five of every six calls
// it makes are cross-origin. None of this is visible until a browser is involved, which is why it
// is tested here rather than found during the demo.
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

// Echoing the origin back rather than sending "*" keeps the allowance as narrow as the six
// processes it exists for.
test("a request from anywhere else is not allowed", async () => {
  await withServer({}, async ({ base }) => {
    for (const origin of ["http://localhost:9999", "https://example.com", "null"]) {
      const response = await request(base, "GET", "/health", { origin });
      assert.equal(response.headers.get("access-control-allow-origin"), null, origin);
    }
  });
});

// One URL gives six different answers, so a cache keyed on the URL alone would hand the farm the
// retailer's.
test("the response varies by origin", async () => {
  await withServer({}, async ({ base }) => {
    const response = await request(base, "GET", "/health", { origin: RETAILER });
    assert.match(response.headers.get("vary") ?? "", /Origin/i);
  });
});

// Every write the page makes is a JSON POST or a PATCH, and both are preflighted. Without this the
// browser never sends the real request at all, and the failure looks like the backend being down.
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

// There are no cookies and no authorisation header, because a backend's identity is fixed at
// startup and nothing a caller sends can change it. Allowing credentials would widen the exposure
// for no reason.
test("credentials are never allowed", async () => {
  await withServer({}, async ({ base }) => {
    for (const method of ["GET", "OPTIONS"]) {
      const response = await request(base, method, "/health", { origin: RETAILER });
      assert.equal(response.headers.get("access-control-allow-credentials"), null, method);
    }
  });
});

// Withholding the allow-origin header only stops a caller *reading* the reply. A POST with no body
// is a simple request, never preflighted, so the transaction would commit before the browser threw
// the response away: any page open in another tab could suspend a stakeholder on the ledger.
test("a write from an unknown origin is refused, not merely made unreadable", async () => {
  const ledger = stubLedger();
  await withServer({ ledger }, async ({ base }) => {
    const response = await request(base, "POST", "/stakeholders/farm-001/suspend", {
      origin: "https://evil.example.com"
    });

    assert.equal(response.status, 403);
  });

  // The important half: nothing reached the ledger.
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

// curl, the oracle and anything else that is not a browser send no Origin at all, and they were
// never what was at risk.
test("a write with no origin header is left alone", async () => {
  const ledger = stubLedger();
  await withServer({ ledger }, async ({ base }) => {
    const response = await request(base, "POST", "/stakeholders/farm-001/suspend", {});
    assert.equal(response.status, 200);
  });

  assert.equal(ledger.calls.length, 1);
});

// A browser treats these as different origins. Opening the page on 127.0.0.1 used to block every
// cross-company call, which looks exactly like all six backends being down.
test("the loopback address is accepted in either spelling", async () => {
  await withServer({}, async ({ base }) => {
    for (const origin of ["http://localhost:3005", "http://127.0.0.1:3005"]) {
      const response = await request(base, "GET", "/health", { origin });
      assert.equal(response.headers.get("access-control-allow-origin"), origin, origin);
    }
  });
});
