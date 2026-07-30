import assert from "node:assert/strict";
import test from "node:test";
import { chaincodeRejection, stubLedger, withServer } from "./harness.mjs";

test("health check does not touch the ledger", async () => {
  await withServer({}, async ({ call, ledger }) => {
    assert.deepEqual(await call("GET", "/health"), { status: 200, body: { status: "ok" } });
    assert.equal(ledger.calls.length, 0);
  });
});

test("stakeholder endpoints call the registry with the right arguments", async () => {
  const ledger = stubLedger({
    evaluate: async () => Buffer.from(JSON.stringify({ stakeholderId: "farm-001", role: "FARM" }))
  });

  await withServer({ ledger }, async ({ call }) => {
    assert.equal(
      (await call("POST", "/stakeholders/bootstrap", { stakeholderId: "regulator-001" })).status,
      201
    );
    assert.equal(
      (
        await call("POST", "/stakeholders", {
          stakeholderId: "farm-001",
          role: "FARM",
          certificateId: "x509::farm"
        })
      ).status,
      201
    );
    assert.equal(
      (await call("PATCH", "/stakeholders/farm-001/role", { role: "PROCESSOR" })).status,
      200
    );
    assert.equal((await call("POST", "/stakeholders/farm-001/suspend")).status, 200);
    assert.equal((await call("POST", "/stakeholders/farm-001/reactivate")).status, 200);

    const read = await call("GET", "/stakeholders/farm-001");
    assert.equal(read.status, 200);
    assert.equal(read.body.role, "FARM");
  });

  assert.deepEqual(
    ledger.calls.map((entry) => [entry.kind, entry.args[2], ...entry.args.slice(3)]),
    [
      ["submit", "bootstrapRegulator", "regulator-001"],
      ["submit", "registerStakeholder", "farm-001", "FARM", "x509::farm"],
      ["submit", "updateStakeholderRole", "farm-001", "PROCESSOR"],
      ["submit", "suspendStakeholder", "farm-001"],
      ["submit", "reactivateStakeholder", "farm-001"],
      ["evaluate", "getStakeholder", "farm-001"]
    ]
  );
  assert.equal(ledger.leaked, false);
});

test("stakeholder registration rejects missing fields before reaching the ledger", async () => {
  const ledger = stubLedger();
  await withServer({ ledger }, async ({ call }) => {
    for (const body of [
      {},
      { stakeholderId: "farm-001" },
      { stakeholderId: "farm-001", role: "FARM" },
      { stakeholderId: "   ", role: "FARM", certificateId: "x509::farm" }
    ]) {
      const result = await call("POST", "/stakeholders", body);
      assert.equal(result.status, 400);
      assert.match(result.body.error, /must be a non-empty string/);
    }
  });
  assert.equal(ledger.calls.length, 0);
});

test("batch endpoints map each lifecycle event to its own transaction", async () => {
  const ledger = stubLedger({
    evaluate: async () => Buffer.from(JSON.stringify({ batchId: "MILK-1", status: "CREATED" }))
  });

  await withServer({ ledger }, async ({ call }) => {
    const created = await call("POST", "/batches", {
      batchId: "MILK-1",
      origin: "Bega Dairy",
      location: "Bega NSW"
    });
    assert.equal(created.status, 201);
    assert.deepEqual(created.body, {
      batchId: "MILK-1",
      origin: "Bega Dairy",
      location: "Bega NSW",
      status: "CREATED"
    });

    for (const [eventType, location] of [
      ["PROCESSING", "Plant"],
      ["TRANSPORT", "Highway"],
      ["DELIVERY", "Depot"]
    ]) {
      assert.equal(
        (await call("POST", "/batches/MILK-1/events", { eventType, location })).status,
        200
      );
    }

    assert.equal(
      (await call("POST", "/batches/MILK-1/recall", { reason: "contamination" })).status,
      200
    );
    assert.equal((await call("GET", "/batches/MILK-1")).status, 200);
    assert.equal((await call("GET", "/batches/MILK-1/history")).status, 200);
  });

  assert.deepEqual(
    ledger.calls.map((entry) => entry.args[2]),
    [
      "createBatch",
      "recordProcessingEvent",
      "startTransport",
      "recordDelivery",
      "recallBatch",
      "getBatch",
      "getBatchHistory"
    ]
  );
  assert.equal(ledger.leaked, false);
});

test("an unknown event type is refused without reaching the ledger", async () => {
  const ledger = stubLedger();
  await withServer({ ledger }, async ({ call }) => {
    const result = await call("POST", "/batches/MILK-1/events", {
      eventType: "TELEPORT",
      location: "Somewhere"
    });
    assert.equal(result.status, 400);
    assert.match(result.body.error, /Unknown eventType 'TELEPORT'/);
  });
  assert.equal(ledger.calls.length, 0);
});

test("batch creation requires origin and location", async () => {
  const ledger = stubLedger();
  await withServer({ ledger }, async ({ call }) => {
    assert.match(
      (await call("POST", "/batches", { batchId: "MILK-1" })).body.error,
      /'origin' must be a non-empty string/
    );
    assert.match(
      (await call("POST", "/batches", { batchId: "MILK-1", origin: "Bega Dairy" })).body.error,
      /'location' must be a non-empty string/
    );
  });
  assert.equal(ledger.calls.length, 0);
});

test("temperature endpoints never send a compliance outcome to the contract", async () => {
  const ledger = stubLedger({
    evaluate: async () =>
      Buffer.from(JSON.stringify({ evidenceId: "EV-1", complianceOutcome: "COMPLIANT" }))
  });

  await withServer({ ledger }, async ({ call }) => {
    const submitted = await call("POST", "/temperature/batches/MILK-1/evidence", {
      evidenceId: "EV-1",
      evidenceHash: "a".repeat(64),
      offChainReference: "postgres://evidence/EV-1",
      statistics: { minCelsius: 1, maxCelsius: 4, averageCelsius: 2, readingCount: 3 },
      complianceOutcome: "COMPLIANT"
    });
    assert.equal(submitted.status, 201);

    assert.equal(
      (await call("POST", "/temperature/batches/MILK-1/resolve-breach", { reason: "inspected" }))
        .status,
      200
    );
    assert.equal((await call("GET", "/temperature/evidence/EV-1")).status, 200);
  });

  const [submit] = ledger.calls;
  assert.equal(submit.args[2], "submitTemperatureEvidence");
  // The caller's outcome is dropped: only the statistics are forwarded, and the contract decides.
  assert.equal(
    submit.args.some((argument) => String(argument).includes("COMPLIANT")),
    false
  );
  assert.equal(ledger.leaked, false);
});

test("evidence submission rejects malformed statistics", async () => {
  const ledger = stubLedger();
  await withServer({ ledger }, async ({ call }) => {
    const result = await call("POST", "/temperature/batches/MILK-1/evidence", {
      evidenceId: "EV-1",
      evidenceHash: "a".repeat(64),
      offChainReference: "ref",
      statistics: "not an object"
    });
    assert.equal(result.status, 400);
    assert.match(result.body.error, /'statistics' must be an object/);
  });
  assert.equal(ledger.calls.length, 0);
});

test("a refused transaction reports the contract's own wording", async () => {
  const ledger = stubLedger({
    submit: async () => {
      throw chaincodeRejection(
        "Stakeholder 'farm-001' has role 'FARM', but this operation requires one of: RETAILER."
      );
    }
  });

  await withServer({ ledger }, async ({ call }) => {
    const result = await call("POST", "/batches/MILK-1/events", {
      eventType: "DELIVERY",
      location: "Depot"
    });
    assert.equal(result.status, 400);
    // The peer's transport prefix is stripped, leaving the message a person can act on.
    assert.equal(
      result.body.error,
      "Stakeholder 'farm-001' has role 'FARM', but this operation requires one of: RETAILER."
    );
  });
  assert.equal(ledger.leaked, false);
});

test("the consumer view exposes the journey but never who recorded it", async () => {
  const batch = {
    batchId: "MILK-1",
    status: "IN_TRANSIT",
    origin: "Bega Dairy",
    lastKnownLocation: "Hume Highway",
    createdAt: "2026-07-30T00:00:00.000Z",
    createdByStakeholderId: "farm-001",
    lastUpdatedByStakeholderId: "logistics-001",
    createdTxId: "tx-secret"
  };
  const history = [
    { timestamp: "2026-07-30T02:00:00.000Z", batch: { status: "IN_TRANSIT" } },
    { timestamp: "2026-07-30T01:00:00.000Z", batch: { status: "PROCESSED" } },
    { timestamp: "2026-07-30T00:00:00.000Z", batch: { status: "CREATED" } }
  ];
  const ledger = stubLedger({
    evaluate: async (_chaincode, _contract, transaction) =>
      Buffer.from(JSON.stringify(transaction === "getBatch" ? batch : history))
  });

  await withServer({ ledger }, async ({ call }) => {
    const result = await call("GET", "/public/batches/MILK-1");
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, {
      batchId: "MILK-1",
      origin: "Bega Dairy",
      lastKnownLocation: "Hume Highway",
      status: "IN_TRANSIT",
      coldChain: "MAINTAINED",
      createdAt: "2026-07-30T00:00:00.000Z",
      milestones: {
        CREATED: "2026-07-30T00:00:00.000Z",
        PROCESSED: "2026-07-30T01:00:00.000Z",
        IN_TRANSIT: "2026-07-30T02:00:00.000Z"
      }
    });
    const serialised = JSON.stringify(result.body);
    for (const secret of ["farm-001", "logistics-001", "tx-secret"]) {
      assert.equal(serialised.includes(secret), false, `${secret} leaked to the public view`);
    }
  });
  assert.equal(ledger.leaked, false);
});

// History arrives newest first. A breach only counts as cleared when the batch went back to
// IN_TRANSIT afterwards, which is the one status resolveTemperatureBreach produces.
test("the consumer view reports a cleared breach apart from one that was never cleared", async () => {
  const entry = (status, hour) => ({
    timestamp: `2026-07-30T0${hour}:00:00.000Z`,
    batch: { status }
  });
  const cases = [
    {
      status: "COLD_CHAIN_BREACH",
      history: [entry("COLD_CHAIN_BREACH", 2), entry("IN_TRANSIT", 1)],
      expected: "UNDER_INVESTIGATION"
    },
    {
      status: "DELIVERED",
      history: [
        entry("DELIVERED", 4),
        entry("IN_TRANSIT", 3),
        entry("COLD_CHAIN_BREACH", 2),
        entry("IN_TRANSIT", 1)
      ],
      expected: "BREACH_RESOLVED"
    },
    // Recalling a breached batch leaves the hold open, so telling a shopper it was resolved would
    // claim someone dealt with a problem nobody dealt with.
    {
      status: "RECALLED",
      history: [entry("RECALLED", 3), entry("COLD_CHAIN_BREACH", 2), entry("IN_TRANSIT", 1)],
      expected: "UNRESOLVED_BREACH"
    },
    {
      status: "DELIVERED",
      history: [entry("DELIVERED", 2), entry("IN_TRANSIT", 1)],
      expected: "MAINTAINED"
    }
  ];

  for (const { status, history, expected } of cases) {
    const ledger = stubLedger({
      evaluate: async (_chaincode, _contract, transaction) =>
        Buffer.from(
          JSON.stringify(
            transaction === "getBatch"
              ? { batchId: "MILK-1", status, createdAt: "2026-07-30T00:00:00.000Z" }
              : history
          )
        )
    });

    await withServer({ ledger }, async ({ call }) => {
      const result = await call("GET", "/public/batches/MILK-1");
      assert.equal(result.body.coldChain, expected, `${status} should report ${expected}`);
      // Batches predating the origin field must still be readable.
      assert.equal(result.body.origin, "not recorded");
    });
  }
});

// The rich query is the reason the network runs CouchDB rather than LevelDB, so it needs a way in.
test("batches can be listed by status", async () => {
  const ledger = stubLedger({
    evaluate: async () => Buffer.from(JSON.stringify([{ batchId: "MILK-1", status: "RECALLED" }]))
  });

  await withServer({ ledger }, async ({ call }) => {
    const result = await call("GET", "/batches?status=RECALLED");

    assert.equal(result.status, 200);
    assert.deepEqual(result.body, [{ batchId: "MILK-1", status: "RECALLED" }]);
    assert.deepEqual(ledger.calls[0].args.slice(2), ["queryBatchesByStatus", "RECALLED"]);
  });
  assert.equal(ledger.leaked, false);
});

test("listing batches without a status is refused before the ledger is reached", async () => {
  const ledger = stubLedger();

  await withServer({ ledger }, async ({ call }) => {
    const result = await call("GET", "/batches");
    assert.equal(result.status, 400);
    assert.match(result.body.error, /status/);
  });
  assert.equal(ledger.calls.length, 0);
});

test("a recalled batch tells the consumer why", async () => {
  const ledger = stubLedger({
    evaluate: async (_chaincode, _contract, transaction) =>
      Buffer.from(
        JSON.stringify(
          transaction === "getBatch"
            ? {
                batchId: "MILK-1",
                status: "RECALLED",
                origin: "Bega Dairy",
                lastKnownLocation: "Depot",
                createdAt: "2026-07-30T00:00:00.000Z",
                recallReason: "contamination found upstream"
              }
            : []
        )
      )
  });

  await withServer({ ledger }, async ({ call }) => {
    const result = await call("GET", "/public/batches/MILK-1");
    assert.equal(result.body.status, "RECALLED");
    assert.equal(result.body.recallReason, "contamination found upstream");
  });
});
