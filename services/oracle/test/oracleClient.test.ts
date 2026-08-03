import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { AnchorError, readAnchoredEvidence, submitTemperatureEvidence } from "../src/oracleClient.js";

const SUBMISSION = {
  evidenceId: "EV-1",
  batchId: "BATCH-001",
  evidenceHash: "a".repeat(64),
  offChainReference: "postgres://temperature_evidence/EV-1",
  statistics: { minCelsius: 1, maxCelsius: 4, averageCelsius: 2, readingCount: 3 }
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
    // The oracle's own backend, on its own port. It is the only one holding the oracle's key, so
    // there is nothing in the request that says who is calling and nothing that could.
    assert.match(submit.url, /^http:\/\/localhost:3006\/temperature\/batches\/BATCH-001\/evidence$/);
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

  it("surfaces the backend's reason when the submission is refused, and reports it never landed", async () => {
    stubFetch([() => json({ error: "Batch 'BATCH-001' must be IN_TRANSIT" }, 400)]);

    await assert.rejects(submitTemperatureEvidence(SUBMISSION), (error: unknown) => {
      assert.ok(error instanceof AnchorError);
      assert.match(error.message, /must be IN_TRANSIT/);
      assert.equal(error.anchored, false);
      return true;
    });
  });

  it("reports that the transaction did land when only the read-back fails", async () => {
    stubFetch([() => json({}, 201), () => json({ error: "peer unavailable" }, 503)]);

    await assert.rejects(submitTemperatureEvidence(SUBMISSION), (error: unknown) => {
      assert.ok(error instanceof AnchorError);
      // The caller must not record this as a failed anchor: the evidence is on the ledger.
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

  // Not being able to tell is not the same as nothing being anchored, and treating it that way is
  // what would let a committed run be written off as failed.
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
});
