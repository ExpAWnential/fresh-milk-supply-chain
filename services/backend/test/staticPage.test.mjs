import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../dist/app.js";

function unusableLedger() {
  throw new Error("the page must not need a ledger connection to load");
}

async function withServer(work) {
  const app = createApp({
    connect: unusableLedger,
    anchoredEvidenceReader: { getAnchoredEvidence: async () => undefined }
  });
  const server = app.listen(0);
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    return await work(async (path) => {
      const response = await fetch(origin + path);
      return { status: response.status, body: await response.text() };
    });
  } finally {
    server.close();
  }
}

// The page has to render before anything is connected, so a network that is down shows the console
// and its errors rather than nothing at all.
test("the demo page is served at the root without touching the ledger", async () => {
  await withServer(async (get) => {
    const result = await get("/");

    assert.equal(result.status, 200);
    assert.match(result.body, /<title>Fresh Milk Cold Chain/);
  });
});

// The console is compiled, so this has to follow the page to where its code actually lives.
// Checking the shell alone would pass even when the page has not been built at all.
test("the page never opens a native dialog, which would be unrecoverable mid-demo", async () => {
  await withServer(async (get) => {
    const page = await get("/");
    assert.equal(page.status, 200);

    const script = page.body.match(/src="([^"]+\.js)"/);
    assert.ok(script, "the page should load its code from a bundle");

    const bundle = await get(script[1].replace(/^\./, ""));
    assert.equal(bundle.status, 200);
    assert.doesNotMatch(bundle.body, /\balert\s*\(|\bconfirm\s*\(|\bprompt\s*\(/);
  });
});
