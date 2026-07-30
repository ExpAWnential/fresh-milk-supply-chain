import assert from "node:assert/strict";
import test from "node:test";
import { getInvokingIdentity } from "../dist/utils/identity.js";
import { getTransactionMetadata } from "../dist/utils/txContext.js";
import { assertActiveRole, getInvokingStakeholder } from "../dist/utils/stakeholderClient.js";

function context({
  certificateId = "cert-farm",
  mspId = "SupplyChainMSP",
  txId = "tx-1",
  seconds = 1_750_000_000,
  nanos = 123_000_000,
  invokeChaincode
} = {}) {
  return {
    clientIdentity: {
      getID: () => certificateId,
      getMSPID: () => mspId
    },
    stub: {
      getTxID: () => txId,
      getTxTimestamp: () => ({ seconds, nanos }),
      invokeChaincode:
        invokeChaincode ??
        (async () => ({
          status: 200,
          message: "OK",
          payload: Buffer.from(
            JSON.stringify({ stakeholderId: "farm-001", role: "FARM", active: true })
          )
        }))
    }
  };
}

// Permission decisions rest on these values, so a missing one must stop the transaction rather
// than be treated as an anonymous caller.
test("an identity without a certificate or an organisation is refused", () => {
  assert.throws(() => getInvokingIdentity(context({ certificateId: "  " })), /certificate ID/);
  assert.throws(() => getInvokingIdentity(context({ mspId: "" })), /MSP ID/);
});

test("the caller's certificate and organisation are read from Fabric, not from arguments", () => {
  assert.deepEqual(getInvokingIdentity(context()), {
    certificateId: "cert-farm",
    mspId: "SupplyChainMSP"
  });
});

test("audit metadata is rejected when Fabric supplies an unusable timestamp or ID", () => {
  assert.throws(
    () => getTransactionMetadata(context({ seconds: Number.MAX_SAFE_INTEGER * 2 })),
    /invalid transaction timestamp/
  );
  assert.throws(() => getTransactionMetadata(context({ nanos: 1.5 })), /invalid transaction timestamp/);
  assert.throws(() => getTransactionMetadata(context({ txId: "   " })), /empty transaction ID/);
});

test("audit metadata converts Fabric's seconds and nanoseconds to an ISO timestamp", () => {
  const metadata = getTransactionMetadata(context({ seconds: 1_750_000_000, nanos: 123_000_000 }));
  assert.equal(metadata.txId, "tx-1");
  assert.equal(metadata.timestamp, new Date(1_750_000_000_123).toISOString());
  assert.equal(metadata.invokingCertificateId, "cert-farm");
});

test("an authorisation answer the registry did not properly give is never trusted", async () => {
  const cases = [
    [{ status: 500, message: "Stakeholder 'farm-001' is suspended.", payload: Buffer.alloc(0) }, /is suspended/],
    [{ status: 500, message: "", payload: Buffer.alloc(0) }, /rejected the caller's authorisation/],
    [{ status: 200, payload: Buffer.alloc(0) }, /empty authorisation response/],
    [{ status: 200, payload: Buffer.from("not json") }, /invalid authorisation response/],
    [{ status: 200, payload: Buffer.from(JSON.stringify({ role: "FARM" })) }, /incomplete authorisation response/],
    [
      { status: 200, payload: Buffer.from(JSON.stringify({ stakeholderId: "f", role: "WIZARD", active: true })) },
      /incomplete authorisation response/
    ]
  ];

  for (const [response, expected] of cases) {
    await assert.rejects(
      assertActiveRole(context({ invokeChaincode: async () => response }), ["FARM"]),
      expected
    );
  }
});

test("a registry answer naming the wrong role or a suspended party is refused locally too", async () => {
  // The registry already checks, but the calling contract does not take its word for it.
  await assert.rejects(
    assertActiveRole(
      context({
        invokeChaincode: async () => ({
          status: 200,
          payload: Buffer.from(
            JSON.stringify({ stakeholderId: "farm-001", role: "FARM", active: true })
          )
        })
      }),
      ["RETAILER"]
    ),
    /requires one of: RETAILER/
  );

  await assert.rejects(
    assertActiveRole(
      context({
        invokeChaincode: async () => ({
          status: 200,
          payload: Buffer.from(
            JSON.stringify({ stakeholderId: "farm-001", role: "FARM", active: false })
          )
        })
      }),
      ["FARM"]
    ),
    /is suspended/
  );
});

test("asking for no roles at all is a programming error, not an open door", async () => {
  await assert.rejects(assertActiveRole(context(), []), /At least one allowed stakeholder role/);
});

test("the registry is asked about the caller's own certificate", async () => {
  let asked;
  await assertActiveRole(
    context({
      certificateId: "cert-farm",
      invokeChaincode: async (chaincodeName, args) => {
        asked = { chaincodeName, args };
        return {
          status: 200,
          payload: Buffer.from(
            JSON.stringify({ stakeholderId: "farm-001", role: "FARM", active: true })
          )
        };
      }
    }),
    ["FARM", "FARM", "PROCESSOR"]
  );

  assert.equal(asked.chaincodeName, "stakeholder");
  assert.equal(asked.args[0], "StakeholderRegistryContract:assertActiveRole");
  assert.equal(asked.args[1], "cert-farm");
  // Duplicates are collapsed so the registry sees each role once.
  assert.deepEqual(JSON.parse(asked.args[2]), ["FARM", "PROCESSOR"]);
});

test("a read only caller may hold any role, provided it is registered and active", async () => {
  const summary = await getInvokingStakeholder(
    context({
      invokeChaincode: async (_name, args) => {
        assert.equal(JSON.parse(args[2]).length, 6);
        return {
          status: 200,
          payload: Buffer.from(
            JSON.stringify({ stakeholderId: "retailer-001", role: "RETAILER", active: true })
          )
        };
      }
    })
  );
  assert.equal(summary.stakeholderId, "retailer-001");
});
