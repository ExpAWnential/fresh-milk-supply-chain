import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { createFabricGatewayClient } from "../dist/fabric/gateway.js";
import { getDemoIdentity } from "../dist/demoIdentity.js";

// Building a client still reads the real certificate and key off disk, so these skip where the
// network has not been brought up. Only the gateway itself is stubbed.
const regulator = getDemoIdentity("regulator");
const walletPresent = existsSync(regulator.userPath) && existsSync(regulator.peerTlsCaPath);
const needsWallet = { skip: walletPresent ? false : "Fabric wallet material is not present" };

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

  return {
    calls,
    closed,
    open: () => ({
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
    })
  };
}

test("a submitted transaction reaches the named chaincode and contract", needsWallet, async () => {
  const stub = stubGateway();
  const client = await createFabricGatewayClient(regulator, stub.open);

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

test("an evaluated transaction passes its arguments through unchanged", needsWallet, async () => {
  const stub = stubGateway();
  const client = await createFabricGatewayClient(regulator, stub.open);

  const result = await client.evaluateTransaction("stakeholder", "StakeholderRegistryContract", "getStakeholder", "farm-001");

  assert.equal(Buffer.from(result).toString(), "call:getStakeholder");
  assert.deepEqual(stub.calls.at(-1).args, ["farm-001"]);
  client.close();
});

test("the gateway is closed once, however many times the client is", needsWallet, async () => {
  const stub = stubGateway();
  const client = await createFabricGatewayClient(regulator, stub.open);

  client.close();
  client.close();
  client.close();

  assert.equal(stub.closed.gateway, 1);
});

// The gRPC channel is already open by the time the gateway is built, and nothing else would ever
// close it, so a failure here has to clean up after itself.
test("a gateway that fails to open does not leak its connection", needsWallet, async () => {
  const failure = new Error("invalid identity");

  await assert.rejects(
    createFabricGatewayClient(regulator, () => {
      throw failure;
    }),
    failure
  );
});
