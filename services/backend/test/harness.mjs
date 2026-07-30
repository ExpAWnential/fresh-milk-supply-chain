import { once } from "node:events";
import { createApp } from "../dist/app.js";

// The routes are exercised against a stub ledger. What matters is which transaction each endpoint
// asks for, with which arguments, and how it reports a refusal, none of which needs a network.
export function stubLedger({ submit, evaluate } = {}) {
  const calls = [];
  let opened = 0;
  let closed = 0;

  const client = {
    async submitTransaction(...args) {
      calls.push({ kind: "submit", args });
      return submit ? submit(...args) : Buffer.alloc(0);
    },
    async evaluateTransaction(...args) {
      calls.push({ kind: "evaluate", args });
      return evaluate ? evaluate(...args) : Buffer.from("{}");
    },
    close() {
      closed += 1;
    }
  };

  return {
    calls,
    connect: async () => {
      opened += 1;
      return client;
    },
    // Every route must release its connection, whether it succeeded or was refused.
    get leaked() {
      return opened !== closed;
    }
  };
}

// A ledger whose every call is refused by the contract, wrapped the way the real gateway wraps it.
export function refusingLedger(message) {
  return failingLedger(chaincodeRejection(message));
}

// A ledger that fails every call with the given error, whatever kind of failure it represents.
export function failingLedger(error) {
  const fail = async () => {
    throw error;
  };
  return {
    connect: async () => ({ submitTransaction: fail, evaluateTransaction: fail, close() {} })
  };
}

export function chaincodeRejection(message) {
  const error = new Error("failed to endorse transaction");
  error.details = [{ message: `chaincode response 500, ${message}` }];
  return error;
}

export function storedEvidence(overrides = {}) {
  return {
    evidenceId: "EV-1",
    batchId: "B-1",
    sensorId: "S-1",
    evidenceHash: "a".repeat(64),
    minCelsius: 1,
    maxCelsius: 2,
    averageCelsius: 1.5,
    readingCount: 1,
    complianceOutcome: "COMPLIANT",
    submissionStatus: "ANCHORED",
    fabricTransactionId: "tx-1",
    ...overrides
  };
}

export function repositoryStub(overrides = {}) {
  return {
    saveEvidence: async () => {},
    markAnchored: async () => {},
    markFailed: async () => {},
    getEvidence: async () => storedEvidence(),
    listEvidenceForBatch: async () => [storedEvidence()],
    recordLedgerOutcome: async () => true,
    getReadings: async () => [
      { sensorId: "S-1", recordedAt: "2026-07-30T00:00:00.000Z", celsius: 2 }
    ],
    ...overrides
  };
}

// Starts the app on an ephemeral port and gives the callback a request helper bound to it.
export async function withServer({ ledger, ...dependencies }, run) {
  const stub = ledger ?? stubLedger();
  const app = createApp({
    connect: stub.connect,
    readAsRegulator: () => stub.connect(),
    readerForRequest: () => ({ getAnchoredEvidence: async () => undefined }),
    ...dependencies
  });
  const server = app.listen(0);
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;

  const call = async (method, path, body) => {
    const response = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json", "x-demo-identity": "regulator" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : undefined };
  };

  try {
    await run({ call, ledger: stub });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}
