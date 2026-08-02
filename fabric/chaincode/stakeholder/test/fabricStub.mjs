// In-memory stand-in for the Fabric ledger, shared by the registry tests.

// Fabric separates composite key parts with NUL. Written as an escape so the file stays ordinary
// text that git can diff.
const KEY_SEPARATOR = "\u0000";

export class MemoryStub {
  state = new Map();
  events = [];
  txNumber = 1;

  createCompositeKey(objectType, attributes) {
    return `${objectType}${KEY_SEPARATOR}${attributes.join(KEY_SEPARATOR)}${KEY_SEPARATOR}`;
  }

  async getState(key) {
    return this.state.get(key) ?? Buffer.alloc(0);
  }

  async putState(key, value) {
    this.state.set(key, Buffer.from(value));
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
}

// Different certificate and MSP values let each test act as a different caller.
export function context(stub, certificateId, mspId = "SupplyChainMSP") {
  return {
    stub,
    clientIdentity: {
      getID: () => certificateId,
      getMSPID: () => mspId
    }
  };
}
