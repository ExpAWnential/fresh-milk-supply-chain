import assert from "node:assert/strict";
import test from "node:test";
import { createFabricGatewayClient } from "../dist/fabric/gateway.js";
import { FIXTURE_IDENTITY } from "./walletFixture.mjs";

// Building a client still reads a real certificate and key off disk, which the committed fixture
// organisation supplies. Only the gateway itself is stubbed.

function stubGateway() {
  const calls = [];
  const closed = { gateway: 0 };
  const contract = (kind) => ({
    submitTransaction: async (name, ...args) => {
      calls.push({ kind, name, args });
      return Buffer.from(`${kind}:${name}`);
    },
    evaluateTransaction: async (name, ...args) => {
      calls.push({ kind, name, args });
      return Buffer.from(`${kind}:${name}`);
    }
  });

  const gateway = {
    getNetwork: (channel) => {
      calls.push({ kind: "network", name: channel, args: [] });
      return {
        getContract: (chaincodeName, contractName) => {
          calls.push({ kind: "contract", name: chaincodeName, args: [contractName] });
          return contract("call");
        }
      };
    },
    close: () => {
      closed.gateway += 1;
    }
  };

  const stub = {
    calls,
    closed,
    // What the gateway was opened with. The identity and the deadlines are only ever visible here.
    options: undefined,
    open: (options) => {
      stub.options = options;
      return gateway;
    }
  };

  return stub;
}

test("a submitted transaction reaches the named chaincode and contract", async () => {
  const stub = stubGateway();
  const client = await createFabricGatewayClient(FIXTURE_IDENTITY, stub.open);

  const result = await client.submitTransaction("supplychain", "BatchLifecycleContract", "createBatch", "B-1", "Bega");

  assert.equal(Buffer.from(result).toString(), "call:createBatch");
  const contractCall = stub.calls.find((entry) => entry.kind === "contract");
  assert.deepEqual([contractCall.name, contractCall.args[0]], [
    "supplychain",
    "BatchLifecycleContract"
  ]);
  const transaction = stub.calls.find((entry) => entry.kind === "call");
  assert.deepEqual(transaction.args, ["B-1", "Bega"]);
  client.close();
});

test("an evaluated transaction passes its arguments through unchanged", async () => {
  const stub = stubGateway();
  const client = await createFabricGatewayClient(FIXTURE_IDENTITY, stub.open);

  const result = await client.evaluateTransaction("stakeholder", "StakeholderRegistryContract", "getStakeholder", "farm-001");

  assert.equal(Buffer.from(result).toString(), "call:getStakeholder");
  assert.deepEqual(stub.calls.at(-1).args, ["farm-001"]);
  client.close();
});

// The identity the gateway is opened with is this company's own, and it is the only one this
// process holds: nothing a caller sends can change which certificate signs.
test("the client signs as the organisation it was built for", async () => {
  const stub = stubGateway();
  const client = await createFabricGatewayClient(FIXTURE_IDENTITY, stub.open);

  assert.equal(stub.options.identity.mspId, "FixtureMSP");
  assert.match(stub.options.identity.credentials.toString(), /BEGIN CERTIFICATE/);
  assert.equal(typeof stub.options.signer, "function");
  client.close();
});

// fabric-gateway applies no deadline of its own, so a peer or orderer that stalls would hold the
// request open forever and never release the channel behind it.
test("every call carries a deadline, so a stalled peer cannot hold a request open", async () => {
  const stub = stubGateway();
  const client = await createFabricGatewayClient(FIXTURE_IDENTITY, stub.open);

  for (const option of [
    "evaluateOptions",
    "endorseOptions",
    "submitOptions",
    "commitStatusOptions"
  ]) {
    const deadline = stub.options[option]().deadline;
    assert.ok(deadline > Date.now(), `${option} carried no deadline in the future`);
  }
  client.close();
});

test("the gateway is closed once, however many times the client is", async () => {
  const stub = stubGateway();
  const client = await createFabricGatewayClient(FIXTURE_IDENTITY, stub.open);

  client.close();
  client.close();
  client.close();

  assert.equal(stub.closed.gateway, 1);
});

// The gRPC channel is already open by the time the gateway is built, and nothing else would ever
// close it, so a failure here has to clean up after itself.
test("a gateway that fails to open does not leak its connection", async () => {
  const failure = new Error("invalid identity");

  await assert.rejects(
    createFabricGatewayClient(FIXTURE_IDENTITY, () => {
      throw failure;
    }),
    failure
  );
});
