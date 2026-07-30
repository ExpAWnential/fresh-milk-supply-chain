import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createApp } from "../dist/app.js";
import { readSingleFile } from "../dist/demoIdentity.js";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Every endpoint has to report a refusal from the contract, not just its happy path. A rejection
// is the business rules working, so it must reach the caller intact.
function rejectingLedger(message) {
  const fail = async () => {
    const error = new Error("failed to endorse transaction");
    error.details = [{ message: `chaincode response 500, ${message}` }];
    throw error;
  };
  return async () => ({
    submitTransaction: fail,
    evaluateTransaction: fail,
    close() {}
  });
}

async function withServer(dependencies, run) {
  const app = createApp(dependencies);
  const server = app.listen(0);
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body) => {
    const response = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json", "x-demo-identity": "regulator" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : undefined };
  };
  try {
    await run(call);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test("every write endpoint passes the contract's refusal back to the caller", async () => {
  const connect = rejectingLedger("Only an active REGULATOR stakeholder may perform this operation.");
  await withServer({ connect, readAsRegulator: connect }, async (call) => {
    const requests = [
      ["POST", "/stakeholders/bootstrap", { stakeholderId: "r1" }],
      ["POST", "/stakeholders", { stakeholderId: "f1", role: "FARM", certificateId: "x509::f" }],
      ["PATCH", "/stakeholders/f1/role", { role: "PROCESSOR" }],
      ["POST", "/stakeholders/f1/suspend"],
      ["POST", "/stakeholders/f1/reactivate"],
      ["GET", "/stakeholders/f1"],
      ["POST", "/batches", { batchId: "b1", origin: "o", location: "l" }],
      ["POST", "/batches/b1/events", { eventType: "DELIVERY", location: "l" }],
      ["POST", "/batches/b1/recall", { reason: "why" }],
      ["GET", "/batches/b1"],
      ["GET", "/batches/b1/history"],
      [
        "POST",
        "/temperature/batches/b1/evidence",
        {
          evidenceId: "e1",
          evidenceHash: "a".repeat(64),
          offChainReference: "ref",
          statistics: { minCelsius: 1, maxCelsius: 2, averageCelsius: 1.5, readingCount: 1 }
        }
      ],
      ["POST", "/temperature/batches/b1/resolve-breach", { reason: "cleared" }],
      ["GET", "/temperature/evidence/e1"],
      ["GET", "/public/batches/b1"]
    ];

    for (const [method, path, body] of requests) {
      const result = await call(method, path, body);
      assert.equal(result.status, 400, `${method} ${path} should report a refusal`);
      assert.equal(
        result.body.error,
        "Only an active REGULATOR stakeholder may perform this operation.",
        `${method} ${path} should keep the contract's wording`
      );
    }
  });
});

test("missing required fields are refused on every write endpoint", async () => {
  const connect = async () => {
    throw new Error("validation should happen before the ledger is reached");
  };
  await withServer({ connect, readAsRegulator: connect }, async (call) => {
    const requests = [
      ["POST", "/stakeholders/bootstrap", {}, /stakeholderId/],
      ["PATCH", "/stakeholders/f1/role", {}, /role/],
      ["POST", "/batches", {}, /batchId/],
      ["POST", "/batches/b1/events", {}, /eventType/],
      ["POST", "/batches/b1/recall", {}, /reason/],
      ["POST", "/temperature/batches/b1/evidence", {}, /evidenceId/],
      ["POST", "/temperature/batches/b1/resolve-breach", {}, /reason/]
    ];

    for (const [method, path, body, expected] of requests) {
      const result = await call(method, path, body);
      assert.equal(result.status, 400, `${method} ${path}`);
      assert.match(result.body.error, expected, `${method} ${path}`);
    }
  });
});

test("verification is unavailable rather than wrong when storage is not configured", async () => {
  const connect = async () => ({ close() {} });
  await withServer({ connect, readAsRegulator: connect }, async (call) => {
    const result = await call("GET", "/temperature/evidence/e1/verify");
    assert.equal(result.status, 503);
    assert.match(result.body.error, /storage is not configured/);
  });
});

test("verification distinguishes unknown evidence from evidence that was never anchored", async () => {
  const connect = async () => ({ close() {} });
  const evidence = {
    evidenceId: "EV-1",
    batchId: "B-1",
    sensorId: "S-1",
    evidenceHash: "a".repeat(64),
    minCelsius: 1,
    maxCelsius: 2,
    averageCelsius: 1.5,
    readingCount: 1,
    complianceOutcome: "COMPLIANT",
    submissionStatus: "ANCHORED",
    fabricTransactionId: "tx-1"
  };

  const cases = [
    { getEvidence: async () => undefined, status: 404, code: "EVIDENCE_NOT_FOUND" },
    {
      getEvidence: async () => ({ ...evidence, submissionStatus: "PENDING", fabricTransactionId: null }),
      status: 409,
      code: "EVIDENCE_NOT_ANCHORED"
    },
    { getEvidence: async () => evidence, getReadings: async () => [], status: 409, code: "READINGS_NOT_FOUND" }
  ];

  for (const { getEvidence, getReadings, status, code } of cases) {
    await withServer(
      {
        connect,
        readAsRegulator: connect,
        temperatureRepository: {
          saveEvidence: async () => {},
          markAnchored: async () => {},
          markFailed: async () => {},
          getEvidence,
          getReadings: getReadings ?? (async () => [{ sensorId: "S-1", recordedAt: "2026-07-30T00:00:00.000Z", celsius: 2 }])
        }
      },
      async (call) => {
        const result = await call("GET", "/temperature/evidence/EV-1/verify");
        assert.equal(result.status, status, code);
        assert.equal(result.body.code, code);
      }
    );
  }
});

test("evidence anchored on the ledger but absent there is reported, not silently trusted", async () => {
  const connect = async () => ({ close() {} });
  await withServer(
    {
      connect,
      readAsRegulator: connect,
      temperatureRepository: {
        saveEvidence: async () => {},
        markAnchored: async () => {},
        markFailed: async () => {},
        getEvidence: async () => ({
          evidenceId: "EV-1",
          batchId: "B-1",
          sensorId: "S-1",
          evidenceHash: "a".repeat(64),
          minCelsius: 1,
          maxCelsius: 2,
          averageCelsius: 1.5,
          readingCount: 1,
          complianceOutcome: "COMPLIANT",
          submissionStatus: "ANCHORED",
          fabricTransactionId: "tx-1"
        }),
        getReadings: async () => [
          { sensorId: "S-1", recordedAt: "2026-07-30T00:00:00.000Z", celsius: 2 }
        ]
      },
      // The ledger has no such record, which must not be mistaken for a match.
      readerForRequest: () => ({ getAnchoredEvidence: async () => undefined })
    },
    async (call) => {
      const result = await call("GET", "/temperature/evidence/EV-1/verify");
      assert.equal(result.status, 409);
      assert.equal(result.body.code, "ANCHORED_EVIDENCE_NOT_FOUND");
    }
  );
});

test("wallet material is located without relying on Fabric's generated file names", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wallet-"));
  await writeFile(join(directory, "some-generated-name.pem"), "certificate");
  assert.equal(await readSingleFile(directory), join(directory, "some-generated-name.pem"));

  await writeFile(join(directory, "a-second.pem"), "certificate");
  await assert.rejects(readSingleFile(directory), /Expected exactly one file/);
});
