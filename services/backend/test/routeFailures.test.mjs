import assert from "node:assert/strict";
import test from "node:test";
import { refusingLedger, repositoryStub, storedEvidence, withServer } from "./harness.mjs";

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
      [
        "POST",
        "/sensors",
        { sensorId: "SENSOR-001", publicKey: "MCowBQYDK2Vw", algorithm: "ed25519" }
      ],
      ["POST", "/sensors/SENSOR-001/revoke"],
      ["GET", "/sensors/SENSOR-001"],
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
          statistics: { minCelsius: 1, maxCelsius: 2, readingCount: 1 }
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

test("the public endpoint never repeats the contract's wording to a consumer", async () => {
  const ledger = refusingLedger("Stakeholder 'regulator-001' is suspended.");
  await withServer({ ledger }, async ({ call }) => {
    const result = await call("GET", "/public/batches/b1");

    assert.equal(result.status, 502);
    assert.doesNotMatch(result.body.error, /regulator-001|suspended/i);
  });
});

// HTTP status distinguishes missing evidence from an inconclusive lookup.
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
      ["POST", "/sensors", {}, /sensorId/],
      ["POST", "/sensors", { sensorId: "SENSOR-001" }, /publicKey/],
      ["POST", "/sensors", { sensorId: "SENSOR-001", publicKey: "MCowBQYDK2Vw" }, /algorithm/],
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

// Routes serving local rows return unavailable for organisations without that store.
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
    // Do not expose database diagnostics in the response.
    assert.doesNotMatch(result.body.error, /connection terminated/);
  });
});

// A silent readings holder is distinct from both checker failure and a clean result.
test("a holder that will not hand its readings over is reported as the holder's failure", async () => {
  const { ReadingsUnavailableError } = await import("../dist/services/readingsSource.js");
  const readingsSource = {
    getReadings: async () => {
      throw new ReadingsUnavailableError("http://localhost:3006", "it answered 503");
    }
  };

  await withServer({ readingsSource }, async ({ call }) => {
    const result = await call("GET", "/temperature/evidence/EV-1/verify");

    assert.equal(result.status, 502);
    assert.equal(result.body.code, "READINGS_UNAVAILABLE");
    // Identify the unresponsive holder.
    assert.match(result.body.error, /http:\/\/localhost:3006/);
    // Unavailable readings never produce a verification result.
    assert.equal(result.body.match, undefined);
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
      // Missing Fabric evidence cannot verify.
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
      // Report Fabric's transaction ID.
      assert.equal(result.body.fabricTransactionId, "tx-from-ledger");
    }
  );
});

// Never substitute the database holder's transaction ID for Fabric's value.
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
