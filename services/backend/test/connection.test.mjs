import assert from "node:assert/strict";
import test from "node:test";
import { connectAs, withGateway } from "../dist/fabric/connection.js";
import { FIXTURE_IDENTITY } from "./walletFixture.mjs";
import { stubLedger } from "./harness.mjs";

// A connection is made per request rather than pooled, and it is bound to the one identity this
// process holds. Nothing a caller sends reaches this, which is what makes "which certificate
// signed" a property of the process rather than of the request.
test("a connector signs as the organisation it was built for and takes nothing from the caller", async () => {
  const connect = connectAs(FIXTURE_IDENTITY);

  assert.equal(connect.length, 0, "the connector should accept no arguments");

  const client = await connect();
  try {
    assert.equal(typeof client.submitTransaction, "function");
    assert.equal(typeof client.evaluateTransaction, "function");
  } finally {
    client.close();
  }
});

test("each call opens its own connection rather than sharing one", async () => {
  const connect = connectAs(FIXTURE_IDENTITY);

  const first = await connect();
  const second = await connect();

  assert.notEqual(first, second);
  first.close();
  second.close();
});

// Every route goes through this, so a connection left open on the failing path would leak one gRPC
// channel per refused request until the process ran out of them.
test("the connection is released whether the work succeeded or threw", async () => {
  const ledger = stubLedger();

  assert.equal(await withGateway(ledger.connect, async () => "done"), "done");

  const refusal = new Error("Batch 'B-1' does not exist.");
  await assert.rejects(
    withGateway(ledger.connect, async () => {
      throw refusal;
    }),
    refusal
  );

  assert.equal(ledger.leaked, false, "a connection was left open");
});

// The work never runs if there was nothing to run it against, and there is no client to release.
test("a connection that could never be opened is reported rather than swallowed", async () => {
  const failure = new Error("14 UNAVAILABLE: No connection established");
  let ran = false;

  await assert.rejects(
    withGateway(
      async () => {
        throw failure;
      },
      async () => {
        ran = true;
      }
    ),
    failure
  );

  assert.equal(ran, false);
});
