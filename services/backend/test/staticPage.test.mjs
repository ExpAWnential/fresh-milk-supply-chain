import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../dist/app.js";

function unusableLedger() {
  throw new Error("the page must not need a ledger connection to load");
}

async function get(path) {
  const app = createApp({
    connect: unusableLedger,
    readAsRegulator: unusableLedger,
    readerForRequest: () => ({ getAnchoredEvidence: async () => undefined })
  });
  const server = app.listen(0);
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`);
    return { status: response.status, body: await response.text() };
  } finally {
    server.close();
  }
}

// The page has to render before anything is connected, so a network that is down shows the panel
// and its errors rather than nothing at all.
test("the demo page is served at the root without touching the ledger", async () => {
  const result = await get("/");

  assert.equal(result.status, 200);
  assert.match(result.body, /<title>Fresh Milk Cold Chain/);
});

test("the page never opens a native dialog, which would be unrecoverable mid-demo", async () => {
  const result = await get("/");

  assert.doesNotMatch(result.body, /\balert\s*\(|\bconfirm\s*\(|\bprompt\s*\(/);
});
