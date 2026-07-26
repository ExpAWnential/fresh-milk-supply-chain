import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canonicaliseReadings,
  serialiseCanonicalReadings
} from "../src/canonicalise.js";
import { assessCompliance, calculateStatistics } from "../src/compliance.js";
import { parseTemperatureReadingsCsv } from "../src/csvReader.js";
import { hashCanonicalEvidence } from "../src/hash.js";

describe("temperature oracle", () => {
  it("parses sensor readings from CSV", () => {
    const readings = parseTemperatureReadingsCsv(`batchId,sensorId,recordedAt,celsius
BATCH-001,SENSOR-001,2026-07-14T08:00:00Z,3.2
BATCH-001,SENSOR-001,2026-07-14T08:15:00Z,3.6`);

    assert.deepEqual(readings, [
      {
        batchId: "BATCH-001",
        sensorId: "SENSOR-001",
        recordedAt: "2026-07-14T08:00:00Z",
        celsius: 3.2
      },
      {
        batchId: "BATCH-001",
        sensorId: "SENSOR-001",
        recordedAt: "2026-07-14T08:15:00Z",
        celsius: 3.6
      }
    ]);
  });

  it("rejects missing required CSV headers", () => {
    assert.throws(
      () => parseTemperatureReadingsCsv(`batchId,sensorId,recordedAt
BATCH-001,SENSOR-001,2026-07-14T08:00:00Z`),
      /missing required header: celsius/
    );
  });

  it("canonicalises readings into deterministic order", () => {
    const canonicalReadings = canonicaliseReadings([
      {
        batchId: " BATCH-001 ",
        sensorId: "SENSOR-002",
        recordedAt: "2026-07-14T08:15:00+00:00",
        celsius: 3.55555
      },
      {
        batchId: "BATCH-001",
        sensorId: "SENSOR-001",
        recordedAt: "2026-07-14T08:00:00Z",
        celsius: 3.2
      }
    ]);

    assert.deepEqual(canonicalReadings, [
      {
        batchId: "BATCH-001",
        sensorId: "SENSOR-001",
        recordedAt: "2026-07-14T08:00:00.000Z",
        celsius: 3.2
      },
      {
        batchId: "BATCH-001",
        sensorId: "SENSOR-002",
        recordedAt: "2026-07-14T08:15:00.000Z",
        celsius: 3.556
      }
    ]);
  });

  it("calculates min, max, average and count", () => {
    const readings = canonicaliseReadings([
      {
        batchId: "BATCH-001",
        sensorId: "SENSOR-001",
        recordedAt: "2026-07-14T08:00:00Z",
        celsius: 3.2
      },
      {
        batchId: "BATCH-001",
        sensorId: "SENSOR-001",
        recordedAt: "2026-07-14T08:15:00Z",
        celsius: 3.6
      },
      {
        batchId: "BATCH-001",
        sensorId: "SENSOR-001",
        recordedAt: "2026-07-14T08:30:00Z",
        celsius: 3.4
      }
    ]);

    assert.deepEqual(calculateStatistics(readings), {
      minCelsius: 3.2,
      maxCelsius: 3.6,
      averageCelsius: 3.4,
      readingCount: 3
    });
  });

  it("produces the same fingerprint for the same readings in different order", () => {
    const firstOrder = canonicaliseReadings([
      {
        batchId: "BATCH-001",
        sensorId: "SENSOR-001",
        recordedAt: "2026-07-14T08:00:00Z",
        celsius: 3.2
      },
      {
        batchId: "BATCH-001",
        sensorId: "SENSOR-001",
        recordedAt: "2026-07-14T08:15:00Z",
        celsius: 3.6
      }
    ]);
    const secondOrder = canonicaliseReadings([...firstOrder].reverse());

    assert.equal(
      hashCanonicalEvidence(serialiseCanonicalReadings(firstOrder)),
      hashCanonicalEvidence(serialiseCanonicalReadings(secondOrder))
    );
  });

  it("marks readings above the cold-chain threshold as unsafe", () => {
    const readings = canonicaliseReadings([
      {
        batchId: "BATCH-002",
        sensorId: "SENSOR-002",
        recordedAt: "2026-07-14T08:00:00Z",
        celsius: 4.1
      },
      {
        batchId: "BATCH-002",
        sensorId: "SENSOR-002",
        recordedAt: "2026-07-14T08:15:00Z",
        celsius: 8.9
      }
    ]);

    assert.equal(assessCompliance(calculateStatistics(readings)), "UNSAFE");
  });
});
