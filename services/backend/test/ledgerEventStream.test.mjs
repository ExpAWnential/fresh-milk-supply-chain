import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createLedgerEventStream } from "../dist/fabric/gateway.js";
import { config } from "../dist/config.js";
import { FIXTURE_IDENTITY } from "./walletFixture.mjs";

// Only the gateway is stubbed. The wallet, the gRPC channel and the checkpoint file are all real,
// which is what leaves the cleanup below worth asserting on: those are the handles that would be
// leaked, and a leaked gRPC channel keeps the process from ever exiting.
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

// A fresh directory each time, so no two streams share a checkpoint unless a test means them to.
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

// Without a start block a fresh listener begins at the *next* block, so everything already on the
// chain is silently never seen and the regulator's archive comes up empty with no error anywhere.
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

// The checkpoint is what makes a restart resume instead of replaying the whole chain, and it has to
// survive the process, so it is written to the file rather than held in memory.
test("checkpointing an event records it on disk for the next process to resume from", async () => {
  const path = await checkpointPath();
  const stub = stubGateway();
  const stream = await createLedgerEventStream(FIXTURE_IDENTITY, "supplychain", path, stub.open);

  await stream.checkpoint(ledgerEvent({ blockNumber: 12n, transactionId: "tx-9" }));
  stream.close();

  // A second listener over the same file starts where the first one stopped.
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

// The gRPC channel is open before the gateway is built, and a failure here leaves the caller no
// handle to close, so it has to clean up after itself or the process can never exit.
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

// A peer that refuses the subscription is the likely one: the gateway opened, so both it and the
// channel are live and neither is reachable from outside this function once it has thrown.
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

// The other way this step fails: an unwritable checkpoint path. It happens before the subscription,
// so the same cleanup has to run from a different point.
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
  // Never subscribed, so there is no event stream to release.
  assert.equal(stub.closed.events, 0);
});
