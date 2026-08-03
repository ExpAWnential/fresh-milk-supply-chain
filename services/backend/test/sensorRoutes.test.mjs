import assert from "node:assert/strict";
import test from "node:test";
import {
  chaincodeRejection,
  failingLedger,
  refusingLedger,
  stubLedger,
  withServer
} from "./harness.mjs";

const PUBLIC_KEY = "MCowBQYDK2VwAyEAGb9ECWmEzf6FQbrBZ9w7lshQhqowtrbLDpp7XFKhwuk=";

const registered = () =>
  stubLedger({
    evaluate: () =>
      Buffer.from(
        JSON.stringify({
          sensorId: "SENSOR-001",
          publicKey: PUBLIC_KEY,
          algorithm: "ed25519",
          active: true
        })
      )
  });

test("the registry is asked for exactly the sensor key transactions", async () => {
  const ledger = registered();

  await withServer({ ledger }, async ({ call }) => {
    assert.equal(
      (
        await call("POST", "/sensors", {
          sensorId: "SENSOR-001",
          publicKey: PUBLIC_KEY,
          algorithm: "ed25519"
        })
      ).status,
      201
    );
    assert.equal((await call("POST", "/sensors/SENSOR-001/revoke")).status, 200);
    assert.equal((await call("GET", "/sensors/SENSOR-001")).status, 200);
  });

  assert.deepEqual(
    ledger.calls.map((entry) => [entry.kind, entry.args[2], ...entry.args.slice(3)]),
    [
      ["submit", "registerSensorKey", "SENSOR-001", PUBLIC_KEY, "ed25519"],
      ["submit", "revokeSensorKey", "SENSOR-001"],
      ["evaluate", "getSensorKey", "SENSOR-001"]
    ]
  );
  assert.equal(ledger.leaked, false);
});

test("the registered key is returned as the ledger holds it", async () => {
  await withServer({ ledger: registered() }, async ({ call }) => {
    const { body } = await call("GET", "/sensors/SENSOR-001");
    assert.equal(body.publicKey, PUBLIC_KEY);
    assert.equal(body.algorithm, "ed25519");
    assert.equal(body.active, true);
  });
});

// Every field is named rather than defaulted. An algorithm the caller left out must not be filled
// in here, or a second scheme could later be registered as the first one by omission.
test("a registration missing any field never reaches the ledger", async () => {
  const ledger = stubLedger();

  await withServer({ ledger }, async ({ call }) => {
    for (const body of [
      { publicKey: PUBLIC_KEY, algorithm: "ed25519" },
      { sensorId: "SENSOR-001", algorithm: "ed25519" },
      { sensorId: "SENSOR-001", publicKey: PUBLIC_KEY },
      { sensorId: "  ", publicKey: PUBLIC_KEY, algorithm: "ed25519" }
    ]) {
      assert.equal((await call("POST", "/sensors", body)).status, 400, JSON.stringify(body));
    }
  });

  assert.deepEqual(ledger.calls, []);
});

// Only the contract knows whether the caller is the regulator, so its wording is what the operator
// sees rather than a guess made here.
test("the contract's own refusal is passed on", async () => {
  await withServer(
    { ledger: refusingLedger("Only an active REGULATOR stakeholder may perform this operation.") },
    async ({ call }) => {
      const { status, body } = await call("POST", "/sensors", {
        sensorId: "SENSOR-001",
        publicKey: PUBLIC_KEY,
        algorithm: "ed25519"
      });

      assert.equal(status, 400);
      assert.match(body.error, /Only an active REGULATOR/);
    }
  );
});

// A verifier reads a 404 as "this sensor was never registered" and refuses the reading on the
// strength of it, so it has to mean exactly that.
test("an unregistered sensor is a 404", async () => {
  await withServer(
    { ledger: failingLedger(chaincodeRejection("Sensor 'SENSOR-404' has no registered key.")) },
    async ({ call }) => {
      const { status, body } = await call("GET", "/sensors/SENSOR-404");
      assert.equal(status, 404);
      assert.match(body.error, /has no registered key/);
    }
  );
});

// The distinction the whole check rests on. A peer that cannot be reached says nothing about
// whether a key exists; reporting that as 404 would let an unreachable ledger pass an unsigned
// reading as merely unregistered.
test("an unreachable ledger is a 502, never a 404", async () => {
  const transportFailure = Object.assign(new Error("14 UNAVAILABLE: no connection established"), {
    code: 14
  });

  await withServer({ ledger: failingLedger(transportFailure) }, async ({ call }) => {
    const { status } = await call("GET", "/sensors/SENSOR-001");
    assert.equal(status, 502);
  });
});
