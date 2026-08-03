import assert from "node:assert/strict";
import test from "node:test";
import { refusingLedger, repositoryStub, storedEvidence, withServer } from "./harness.mjs";

// Every endpoint has to report a refusal from the contract, not just its happy path. A rejection
// is the business rules working, so it must reach the caller intact.
test("every endpoint passes the contract's refusal back to the caller", async () => {
  const ledger = refusingLedger("Only an active REGULATOR stakeholder may perform this operation.");
  await withServer({ ledger }, async ({ call }) => {
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
      ["GET", "/temperature/evidence/e1"]
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

// The one route without an authenticated caller. The contract's wording names stakeholders and
// registry state, which is exactly what the consumer view strips out of a successful response.
test("the public endpoint never repeats the contract's wording to a consumer", async () => {
  const ledger = refusingLedger("Stakeholder 'regulator-001' is suspended.");
  await withServer({ ledger }, async ({ call }) => {
    const result = await call("GET", "/public/batches/b1");

    assert.equal(result.status, 502);
    assert.doesNotMatch(result.body.error, /regulator-001|suspended/i);
  });
});

// Answering with a status rather than prose is what lets the oracle tell "never anchored" apart
// from "could not tell", without a second copy of the contract's wording living in that package.
test("evidence the ledger has never seen is reported as not found", async () => {
  const ledger = refusingLedger("Temperature evidence 'EV-1' does not exist.");
  await withServer({ ledger }, async ({ call }) => {
    const result = await call("GET", "/temperature/evidence/EV-1");

    assert.equal(result.status, 404);
    assert.match(result.body.error, /is not on the ledger/);
  });
});

test("a refusal to read evidence stays a refusal rather than becoming not found", async () => {
  const ledger = refusingLedger("Stakeholder 'farm-001' does not exist.");
  await withServer({ ledger }, async ({ call }) => {
    const result = await call("GET", "/temperature/evidence/EV-1");
    assert.equal(result.status, 400);
  });
});

test("an unknown batch code is reported to a consumer as not found", async () => {
  const ledger = refusingLedger("Batch 'b1' does not exist.");
  await withServer({ ledger }, async ({ call }) => {
    const result = await call("GET", "/public/batches/b1");

    assert.equal(result.status, 404);
    assert.match(result.body.error, /could not find that batch code/i);
  });
});

test("missing required fields are refused before the ledger is reached", async () => {
  const ledger = refusingLedger("the ledger should not have been reached");
  await withServer({ ledger }, async ({ call }) => {
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

// Four of the six companies keep no off-chain database, so this is the ordinary answer on most of
// the network rather than a misconfiguration. It must say so instead of reporting a fault. Only
// the routes that serve stored rows are affected: verification is not, because it fetches the
// readings from whoever holds them.
test("the routes that serve stored rows are unavailable rather than wrong without a database", async () => {
  const needStorage = [
    "/temperature/evidence/e1/readings",
    "/temperature/batches/BATCH-001/evidence"
  ];

  await withServer({}, async ({ call }) => {
    for (const path of needStorage) {
      const result = await call("GET", path);
      assert.equal(result.status, 503, path);
      assert.match(result.body.error, /storage is not configured/);
    }
  });
});

// An unexpected failure during verification must not be dressed up as a verification result.
test("an unexpected verification failure is reported as a server fault", async () => {
  const temperatureRepository = repositoryStub({
    getEvidence: async () => {
      throw new Error("connection terminated unexpectedly");
    }
  });

  await withServer({ temperatureRepository }, async ({ call }) => {
    const result = await call("GET", "/temperature/evidence/EV-1/verify");
    assert.equal(result.status, 500);
    assert.match(result.body.error, /failed to verify temperature evidence/);
    // The database's own wording stays in the log, not in the response.
    assert.doesNotMatch(result.body.error, /connection terminated/);
  });
});

test("verification names which precondition failed", async () => {
  const cases = [
    {
      code: "EVIDENCE_NOT_FOUND",
      status: 404,
      repository: repositoryStub({ getEvidence: async () => undefined })
    },
    {
      code: "EVIDENCE_NOT_ANCHORED",
      status: 409,
      repository: repositoryStub({
        getEvidence: async () =>
          storedEvidence({ submissionStatus: "PENDING", fabricTransactionId: null })
      })
    },
    {
      code: "READINGS_NOT_FOUND",
      status: 409,
      repository: repositoryStub({ getReadings: async () => [] })
    },
    {
      // The ledger has no such record, which must never be mistaken for a match.
      code: "ANCHORED_EVIDENCE_NOT_FOUND",
      status: 409,
      repository: repositoryStub()
    }
  ];

  for (const { code, status, repository } of cases) {
    await withServer({ temperatureRepository: repository }, async ({ call }) => {
      const result = await call("GET", "/temperature/evidence/EV-1/verify");
      assert.equal(result.status, status, code);
      assert.equal(result.body.code, code);
    });
  }
});

test("a match is only reported when the ledger itself supplies the anchor", async () => {
  const readings = [{ sensorId: "S-1", recordedAt: "2026-07-30T00:00:00.000Z", celsius: 2 }];
  const { sha256TemperatureReadings } = await import("@fresh-milk/storage");
  const anchored = sha256TemperatureReadings("B-1", readings);

  await withServer(
    {
      temperatureRepository: repositoryStub({
        getEvidence: async () => storedEvidence({ evidenceHash: anchored }),
        getReadings: async () => readings
      }),
      anchoredEvidenceReader: {
        getAnchoredEvidence: async () => ({
          batchId: "B-1",
          evidenceHash: anchored,
          fabricTransactionId: "tx-from-ledger"
        })
      }
    },
    async ({ call }) => {
      const result = await call("GET", "/temperature/evidence/EV-1/verify");
      assert.equal(result.status, 200);
      assert.equal(result.body.match, true);
      assert.equal(result.body.databaseHashMatchesAnchor, true);
      // The transaction ID reported is the ledger's, not the database's copy.
      assert.equal(result.body.fabricTransactionId, "tx-from-ledger");
    }
  );
});

// Falling back to the database's copy would hand an auditor a transaction ID taken from the very
// record they are checking, under a field documented as coming off the ledger.
test("an anchor with no transaction ID is reported as missing, not filled in from the database", async () => {
  const readings = [{ sensorId: "S-1", recordedAt: "2026-07-30T00:00:00.000Z", celsius: 2 }];
  const { sha256TemperatureReadings } = await import("@fresh-milk/storage");
  const anchored = sha256TemperatureReadings("B-1", readings);

  await withServer(
    {
      temperatureRepository: repositoryStub({
        getEvidence: async () =>
          storedEvidence({ evidenceHash: anchored, fabricTransactionId: "tx-from-database" }),
        getReadings: async () => readings
      }),
      anchoredEvidenceReader: {
        getAnchoredEvidence: async () => ({ batchId: "B-1", evidenceHash: anchored })
      }
    },
    async ({ call }) => {
      const result = await call("GET", "/temperature/evidence/EV-1/verify");
      assert.equal(result.status, 200);
      assert.equal(result.body.fabricTransactionId, null);
    }
  );
});

test("an altered reading breaks the match while the ledger's hash stays put", async () => {
  const anchored = "a".repeat(64);
  await withServer(
    {
      temperatureRepository: repositoryStub({
        getEvidence: async () => storedEvidence({ evidenceHash: anchored })
      }),
      anchoredEvidenceReader: {
        getAnchoredEvidence: async () => ({
          batchId: "B-1",
          evidenceHash: anchored,
          fabricTransactionId: "tx-1"
        })
      }
    },
    async ({ call }) => {
      const result = await call("GET", "/temperature/evidence/EV-1/verify");
      assert.equal(result.status, 200);
      assert.equal(result.body.match, false);
      assert.equal(result.body.anchoredHash, anchored);
      assert.notEqual(result.body.recomputedHash, anchored);
    }
  );
});
