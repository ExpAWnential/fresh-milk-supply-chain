// One in-memory stand-in for the Fabric ledger, shared by every supply-chain contract test, so
// they all agree on how composite keys are formed and on what the registry is asked.

// Fabric separates composite key parts with NUL. Written as an escape so the test files stay
// ordinary text that git can diff.
const KEY_SEPARATOR = "\u0000";

export const STAKEHOLDERS = new Map([
  ["cert-farm", { stakeholderId: "farm-001", role: "FARM", active: true }],
  ["cert-processor", { stakeholderId: "processor-001", role: "PROCESSOR", active: true }],
  ["cert-logistics", { stakeholderId: "logistics-001", role: "LOGISTICS", active: true }],
  ["cert-retailer", { stakeholderId: "retailer-001", role: "RETAILER", active: true }],
  ["cert-regulator", { stakeholderId: "regulator-001", role: "REGULATOR", active: true }],
  ["cert-oracle", { stakeholderId: "oracle-001", role: "ORACLE", active: true }],
  ["cert-suspended", { stakeholderId: "processor-002", role: "PROCESSOR", active: false }],
  ["cert-suspended-oracle", { stakeholderId: "oracle-002", role: "ORACLE", active: false }]
]);

class MemoryIterator {
  #items;
  #index = 0;
  closed = false;

  constructor(items) {
    this.#items = items;
  }

  async next() {
    return this.#index >= this.#items.length
      ? { done: true }
      : { done: false, value: this.#items[this.#index++] };
  }

  async close() {
    this.closed = true;
  }
}

export class MemoryStub {
  state = new Map();
  history = new Map();
  events = [];
  txNumber = 1;
  currentCertificateId = "";
  stakeholders = new Map(STAKEHOLDERS);

  createCompositeKey(objectType, attributes) {
    return `${objectType}${KEY_SEPARATOR}${attributes.join(KEY_SEPARATOR)}${KEY_SEPARATOR}`;
  }

  async getState(key) {
    return this.state.get(key) ?? Buffer.alloc(0);
  }

  async putState(key, value) {
    const stored = Buffer.from(value);
    this.state.set(key, stored);
    const entries = this.history.get(key) ?? [];
    entries.push({
      txId: this.getTxID(),
      timestamp: this.getTxTimestamp(),
      isDelete: false,
      value: stored
    });
    this.history.set(key, entries);
  }

  async getHistoryForKey(key) {
    return new MemoryIterator(this.history.get(key) ?? []);
  }

  async getQueryResult(query) {
    const { selector } = JSON.parse(query);
    return new MemoryIterator(
      [...this.state.entries()]
        .filter(
          ([key, value]) =>
            key.startsWith(`batch${KEY_SEPARATOR}`) &&
            JSON.parse(value.toString()).status === selector.status
        )
        .map(([key, value]) => ({ key, value }))
    );
  }

  getTxID() {
    return `tx-${this.txNumber}`;
  }

  getTxTimestamp() {
    return { seconds: 1_750_000_000 + this.txNumber, nanos: 123_000_000 };
  }

  setEvent(name, payload) {
    this.events.push({ name, payload: Buffer.from(payload) });
  }

  // Stands in for the stakeholder registry. It insists the contract passes the caller's own
  // certificate, which is the guarantee the cross-chaincode check exists to provide.
  async invokeChaincode(chaincodeName, args) {
    if (chaincodeName !== "stakeholder") {
      return { status: 500, message: "Unexpected chaincode", payload: Buffer.alloc(0) };
    }
    if (args[0] !== "StakeholderRegistryContract:assertActiveRole") {
      return { status: 500, message: "Unexpected transaction", payload: Buffer.alloc(0) };
    }
    if (args[1] !== this.currentCertificateId) {
      return { status: 500, message: "Certificate mismatch", payload: Buffer.alloc(0) };
    }

    const stakeholder = this.stakeholders.get(this.currentCertificateId);
    if (!stakeholder) {
      return {
        status: 500,
        message: "The invoking certificate is not registered to a stakeholder.",
        payload: Buffer.alloc(0)
      };
    }
    if (!stakeholder.active) {
      return {
        status: 500,
        message: `Stakeholder '${stakeholder.stakeholderId}' is suspended.`,
        payload: Buffer.alloc(0)
      };
    }

    const allowedRoles = JSON.parse(args[2]);
    if (!allowedRoles.includes(stakeholder.role)) {
      return {
        status: 500,
        message:
          `Stakeholder '${stakeholder.stakeholderId}' has role '${stakeholder.role}', ` +
          `but this operation requires one of: ${allowedRoles.join(", ")}.`,
        payload: Buffer.alloc(0)
      };
    }

    return { status: 200, message: "OK", payload: Buffer.from(JSON.stringify(stakeholder)) };
  }

  nextTransaction() {
    this.txNumber += 1;
  }
}

export function context(stub, certificateId) {
  stub.currentCertificateId = certificateId;
  return {
    stub,
    clientIdentity: {
      getID: () => certificateId,
      getMSPID: () => "SupplyChainMSP"
    }
  };
}

// Advances the transaction number afterwards, so each write lands in its own history entry.
export async function transact(stub, certificateId, operation) {
  const result = await operation(context(stub, certificateId));
  stub.nextTransaction();
  return result;
}
