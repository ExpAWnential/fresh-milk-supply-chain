import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseArguments } from "../src/tamperEvidence.js";

// The demo deliberately corrupts stored data, so its guards matter more than usual.
describe("tamper demo arguments", () => {
  it("requires the evidence to change", () => {
    assert.throws(() => parseArguments([]), /Usage: pnpm demo:tamper/);
    assert.throws(() => parseArguments(["--evidence", "   "]), /Usage: pnpm demo:tamper/);
  });

  it("refuses a change too small to alter the fingerprint", () => {
    assert.throws(() => parseArguments(["--evidence", "EV-1", "--delta", "0"]), /at least 0.01/);
    assert.throws(
      () => parseArguments(["--evidence", "EV-1", "--delta", "not a number"]),
      /at least 0.01/
    );
  });

  it("treats the confirmation flag as absent unless it is given", () => {
    assert.equal(parseArguments(["--evidence", "EV-1"]).confirmed, false);
    assert.equal(
      parseArguments(["--evidence", "EV-1", "--confirm-tamper"]).confirmed,
      true
    );
  });

  it("defaults the change to one degree", () => {
    assert.equal(parseArguments(["--evidence", "EV-1"]).deltaCelsius, 1);
    assert.equal(parseArguments(["--evidence", "EV-1", "--delta", "-2.5"]).deltaCelsius, -2.5);
  });
});
