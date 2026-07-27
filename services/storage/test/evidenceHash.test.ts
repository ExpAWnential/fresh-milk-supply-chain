import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canonicaliseTemperatureReadings,
  sha256TemperatureReadings
} from "../src/evidenceHash.js";

const readings = [
  {
    sensorId: " SENSOR-01 ",
    recordedAt: "2026-07-20T09:05:00+00:00",
    celsius: 3.45555
  },
  {
    sensorId: "SENSOR-01",
    recordedAt: "2026-07-20T09:00:00Z",
    celsius: 3.2
  }
];

describe("temperature evidence hash", () => {
  it("matches the oracle's canonical field order, precision and sorting", () => {
    assert.equal(
      canonicaliseTemperatureReadings(" BATCH-001 ", readings),
      JSON.stringify([
        {
          batchId: "BATCH-001",
          sensorId: "SENSOR-01",
          recordedAt: "2026-07-20T09:00:00.000Z",
          celsius: 3.2
        },
        {
          batchId: "BATCH-001",
          sensorId: "SENSOR-01",
          recordedAt: "2026-07-20T09:05:00.000Z",
          celsius: 3.456
        }
      ])
    );
  });

  it("is independent of input order but changes after tampering", () => {
    const originalHash = sha256TemperatureReadings("BATCH-001", readings);
    assert.equal(
      originalHash,
      sha256TemperatureReadings("BATCH-001", [...readings].reverse())
    );
    assert.match(originalHash, /^[a-f0-9]{64}$/);

    const changed = readings.map((reading, index) =>
      index === 0 ? { ...reading, celsius: reading.celsius + 1 } : reading
    );
    assert.notEqual(
      sha256TemperatureReadings("BATCH-001", changed),
      originalHash
    );
  });

  it("rejects empty or malformed input", () => {
    assert.throws(
      () => canonicaliseTemperatureReadings("BATCH-001", []),
      /At least one/
    );
    assert.throws(
      () =>
        canonicaliseTemperatureReadings("BATCH-001", [
          { sensorId: "SENSOR-01", recordedAt: "not-a-date", celsius: 3 }
        ]),
      /Invalid temperature reading timestamp/
    );
  });
});
