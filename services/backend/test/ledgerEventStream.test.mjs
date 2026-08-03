import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createLedgerEventStream } from "../dist/fabric/gateway.js";
import { config } from "../dist/config.js";
import { FIXTURE_IDENTITY } from "./walletFixture.mjs";

// Use real wallet, gRPC and checkpoint resources so cleanup assertions cover actual handles.
function stubGateway({ events, failSubscription } = {}) {
  const closed = { gateway: 0, events: 0 };
  const subscriptions = [];

  const subscription = {
    async *[Symbol.asyncIterator]() {
      yield* events ?? [];
    },
    close() {
      closed.events += 1;
    }
  };

  return {
    closed,
    subscriptions,
    open: () => ({
      getNetwork: (channelName) => ({
        getChaincodeEvents: async (chaincodeName, options) => {
          subscriptions.push({ channelName, chaincodeName, options });
          if (failSubscription) {
            throw failSubscription;
          }
          return subscription;
        }
      }),
      close: () => {
        closed.gateway += 1;
      }
    })
  };
}

const ledgerEvent = (overrides = {}) => ({
  blockNumber: 7n,
  transactionId: "tx-1",
  chaincodeName: "supplychain",
  eventName: "TemperatureEvidenceSubmitted",
  payload: Buffer.from("{}"),
  ...overrides
});

// Isolate checkpoint files unless a test deliberately reuses one.
async function checkpointPath() {
  return join(await mkdtemp(join(tmpdir(), "events-")), "events.checkpoint");
}

test("the stream subscribes to the named chaincode on the configured channel", async () => {
  const stub = stubGateway();
  const stream = await createLedgerEventStream(
    FIXTURE_IDENTITY,
    "supplychain",
    await checkpointPath(),
    stub.open
  );

  const [subscription] = stub.subscriptions;
  assert.equal(subscription.channelName, config.fabricChannelName);
  assert.equal(subscription.chaincodeName, "supplychain");
  stream.close();
});

test("a first run reads the chain from the beginning rather than from the next block", async () => {
  const stub = stubGateway();
  const stream = await createLedgerEventStream(
    FIXTURE_IDENTITY,
    "supplychain",
    await checkpointPath(),
    stub.open
  );

  assert.equal(stub.subscriptions[0].options.startBlock, 0n);
  assert.equal(typeof stub.subscriptions[0].options.checkpoint.getBlockNumber, "function");
  stream.close();
});

test("the events the peer yields are what the caller iterates", async () => {
  const stub = stubGateway({ events: [ledgerEvent(), ledgerEvent({ transactionId: "tx-2" })] });
  const stream = await createLedgerEventStream(
    FIXTURE_IDENTITY,
    "supplychain",
    await checkpointPath(),
    stub.open
  );

  const seen = [];
  for await (const event of stream.events) {
    seen.push(event.transactionId);
  }

  assert.deepEqual(seen, ["tx-1", "tx-2"]);
  stream.close();
});

test("checkpointing an event records it on disk for the next process to resume from", async () => {
  const path = await checkpointPath();
  const stub = stubGateway();
  const stream = await createLedgerEventStream(FIXTURE_IDENTITY, "supplychain", path, stub.open);

  await stream.checkpoint(ledgerEvent({ blockNumber: 12n, transactionId: "tx-9" }));
  stream.close();

  // Reusing the file resumes from the first listener's position.
  const resumed = stubGateway();
  const next = await createLedgerEventStream(FIXTURE_IDENTITY, "supplychain", path, resumed.open);
  const checkpoint = resumed.subscriptions[0].options.checkpoint;

  assert.equal(checkpoint.getBlockNumber(), 12n);
  assert.equal(checkpoint.getTransactionId(), "tx-9");
  next.close();
});

test("closing the stream releases the subscription and the gateway", async () => {
  const stub = stubGateway();
  const stream = await createLedgerEventStream(
    FIXTURE_IDENTITY,
    "supplychain",
    await checkpointPath(),
    stub.open
  );

  stream.close();

  assert.deepEqual(stub.closed, { gateway: 1, events: 1 });
});

test("a gateway that fails to open does not leak the channel underneath it", async () => {
  const failure = new Error("invalid identity");

  await assert.rejects(
    createLedgerEventStream(
      FIXTURE_IDENTITY,
      "supplychain",
      await checkpointPath(),
      () => {
        throw failure;
      }
    ),
    failure
  );
});

test("a refused subscription closes the gateway rather than leaving it open", async () => {
  const stub = stubGateway({ failSubscription: new Error("peer refused the subscription") });

  await assert.rejects(
    createLedgerEventStream(
      FIXTURE_IDENTITY,
      "supplychain",
      await checkpointPath(),
      stub.open
    ),
    /peer refused the subscription/
  );

  assert.equal(stub.closed.gateway, 1);
});

// Checkpoint setup failure follows the same cleanup path before subscription begins.
test("an unusable checkpoint file closes the gateway rather than leaving it open", async () => {
  const stub = stubGateway();

  await assert.rejects(
    createLedgerEventStream(
      FIXTURE_IDENTITY,
      "supplychain",
      join("/nonexistent-directory", "h.checkpoint"),
      stub.open
    )
  );

  assert.equal(stub.closed.gateway, 1);
  // No event stream exists before checkpoint setup succeeds.
  assert.equal(stub.closed.events, 0);
});
