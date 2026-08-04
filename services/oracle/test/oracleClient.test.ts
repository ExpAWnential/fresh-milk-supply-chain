import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, it } from "node:test";
import {
  AnchorError,
  readAnchoredEvidence,
  submitTemperatureEvidence
} from "../src/oracleClient.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const SUBMISSION = {
  evidenceId: "EV-1",
  batchId: "BATCH-001",
  evidenceHash: "a".repeat(64),
  offChainReference: "postgres://temperature_evidence/EV-1",
  statistics: { minCelsius: 1, maxCelsius: 4, readingCount: 3 }
};

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(handlers: ((url: string, init?: RequestInit) => Response)[]) {
  const requests: { url: string; init?: RequestInit }[] = [];
  let call = 0;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    return handlers[Math.min(call++, handlers.length - 1)](String(url), init);
  }) as typeof fetch;
  return requests;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("anchoring evidence through the backend", () => {
  it("submits as the oracle identity and never sends a compliance outcome", async () => {
    const requests = stubFetch([
      () => json({ evidenceId: "EV-1" }, 201),
      () => json({ submittedTxId: "tx-1", complianceOutcome: "COMPLIANT" })
    ]);

    const anchored = await submitTemperatureEvidence(SUBMISSION);

    assert.equal(anchored.submittedTxId, "tx-1");
    assert.equal(anchored.complianceOutcome, "COMPLIANT");

    const [submit] = requests;
    // Submission goes through the backend that holds the oracle identity.
    assert.match(
      submit.url,
      /^http:\/\/localhost:3006\/temperature\/batches\/BATCH-001\/evidence$/
    );
    assert.deepEqual(Object.keys(submit.init?.headers ?? {}), ["content-type"]);
    const body = JSON.parse(String(submit.init?.body));
    assert.deepEqual(Object.keys(body).sort(), [
      "evidenceHash",
      "evidenceId",
      "offChainReference",
      "statistics"
    ]);
  });

  it("reads the anchored record back to learn the transaction it landed in", async () => {
    const requests = stubFetch([
      () => json({}, 201),
      () => json({ submittedTxId: "tx-2", complianceOutcome: "UNSAFE" })
    ]);

    await submitTemperatureEvidence(SUBMISSION);

    assert.equal(requests.length, 2);
    assert.match(requests[1].url, /\/temperature\/evidence\/EV-1$/);
  });

  // Retry handling depends on whether Fabric committed the transaction.
  it("surfaces the backend's reason when the submission is refused, and reports it never landed", async () => {
    stubFetch([() => json({ error: "Batch 'BATCH-001' must be IN_TRANSIT" }, 400)]);

    await assert.rejects(submitTemperatureEvidence(SUBMISSION), (error: unknown) => {
      assert.ok(error instanceof AnchorError);
      assert.equal(error.name, "AnchorError");
      assert.match(error.message, /must be IN_TRANSIT/);
      assert.equal(error.anchored, false);
      return true;
    });
  });

  it("reports that the transaction did land when only the read-back fails", async () => {
    stubFetch([() => json({}, 201), () => json({ error: "peer unavailable" }, 503)]);

    await assert.rejects(submitTemperatureEvidence(SUBMISSION), (error: unknown) => {
      assert.ok(error instanceof AnchorError);
      // A committed transaction must not be marked as a failed anchor.
      assert.equal(error.anchored, true);
      return true;
    });
  });

  it("fails loudly when the anchored record carries no transaction ID", async () => {
    stubFetch([() => json({}, 201), () => json({ complianceOutcome: "COMPLIANT" })]);

    await assert.rejects(submitTemperatureEvidence(SUBMISSION), (error: unknown) => {
      assert.ok(error instanceof AnchorError);
      assert.match(error.message, /no transaction ID/);
      assert.equal(error.anchored, true);
      return true;
    });
  });

  it("reads nothing anchored when the backend reports the evidence is not there", async () => {
    stubFetch([() => json({ error: "Evidence 'EV-1' is not on the ledger." }, 404)]);

    assert.equal(await readAnchoredEvidence("EV-1"), undefined);
  });

  // An inconclusive lookup is not evidence that no anchor exists.
  it("raises anything other than a plain not found", async () => {
    for (const status of [400, 500, 503]) {
      stubFetch([() => json({ error: "peer unavailable" }, status)]);
      await assert.rejects(readAnchoredEvidence("EV-1"), /peer unavailable/, String(status));
    }
  });

  it("reports a non-JSON failure without hiding the status", async () => {
    stubFetch([() => new Response("<html>gateway timeout</html>", { status: 504 })]);

    await assert.rejects(submitTemperatureEvidence(SUBMISSION), /504/);
  });

  it("falls back to the status and body when the failure names no reason", async () => {
    stubFetch([() => json({ detail: "no route to host" }, 502)]);

    await assert.rejects(submitTemperatureEvidence(SUBMISSION), (error: Error) => {
      assert.match(error.message, /502/);
      assert.match(error.message, /no route to host/);
      return true;
    });
  });

  it("talks to the oracle's own backend by default", async () => {
    const requests = stubFetch([() => json({}, 201), () => json({ submittedTxId: "tx-1" })]);

    await submitTemperatureEvidence(SUBMISSION);

    assert.ok(requests[0].url.startsWith("http://localhost:3006/"), requests[0].url);
  });

  // Use a child process because the backend address is read at module load time.
  it("follows BACKEND_URL, which is read once when the module loads", () => {
    const child = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "-e",
        `globalThis.fetch = async (url) => { console.log(String(url)); process.exit(0); };
         const { readAnchoredEvidence } = await import("./src/oracleClient.ts");
         await readAnchoredEvidence("EV-1");`
      ],
      {
        cwd: packageRoot,
        encoding: "utf8",
        env: { ...process.env, BACKEND_URL: "http://localhost:4006" }
      }
    );

    assert.match(child.stdout, /^http:\/\/localhost:4006\/temperature\/evidence\/EV-1/m);
  });
});
