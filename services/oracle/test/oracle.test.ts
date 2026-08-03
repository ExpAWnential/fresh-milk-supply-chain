import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sha256TemperatureReadings } from "@fresh-milk/storage";
import { canonicaliseReadings } from "../src/canonicalise.js";
import { calculateTemperatureStatistics as calculateStatistics } from "@fresh-milk/storage";
import { assessCompliance } from "../src/compliance.js";
import { parseTemperatureReadingsCsv } from "../src/csvReader.js";

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

  it("calculates min, max and count", () => {
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
      readingCount: 3
    });
  });

  // Hashed with the same function the oracle anchors with, so this proves order independence
  // of the fingerprint that actually reaches the ledger.
  it("produces the same fingerprint for the same readings in different order", () => {
    const readings = [
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
    ];
    const strip = (list: readonly { sensorId: string; recordedAt: string; celsius: number }[]) =>
      list.map(({ sensorId, recordedAt, celsius }) => ({ sensorId, recordedAt, celsius }));

    assert.equal(
      sha256TemperatureReadings("BATCH-001", strip(canonicaliseReadings(readings))),
      sha256TemperatureReadings("BATCH-001", strip(canonicaliseReadings([...readings].reverse())))
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

  // The contract re-derives this outcome from the same 0-5C range, so the boundaries and the
  // frozen-milk case must agree with TemperatureComplianceContract.
  it("applies the same 0-5C range as the on-chain contract", () => {
    assert.equal(
      assessCompliance({ minCelsius: 0, maxCelsius: 5, readingCount: 2 }),
      "COMPLIANT"
    );
    assert.equal(
      assessCompliance({ minCelsius: -0.1, maxCelsius: 3, readingCount: 2 }),
      "UNSAFE"
    );
    assert.equal(
      assessCompliance({ minCelsius: 3, maxCelsius: 5.1, readingCount: 2 }),
      "UNSAFE"
    );
  });

  it("refuses to calculate statistics for no readings at all", () => {
    assert.throws(() => calculateStatistics([]), /empty reading set/);
  });

  // A reading the oracle cannot make sense of must stop the run. Canonicalising it to something
  // plausible would put a fingerprint on the ledger covering readings nobody recorded.
  it("refuses a timestamp it cannot read", () => {
    assert.throws(
      () =>
        canonicaliseReadings([
          { batchId: "B-1", sensorId: "S-1", recordedAt: "last tuesday", celsius: 3 }
        ]),
      /Invalid recordedAt timestamp: last tuesday/
    );
  });

  // A blank cell in the CSV. Canonicalising it to an empty string would anchor a fingerprint over
  // readings attributed to no batch and no sensor, which nothing could later be checked against.
  it("refuses a reading with no batch or no sensor, naming the field", () => {
    const reading = { batchId: "B-1", sensorId: "S-1", recordedAt: "2026-07-14T08:00:00Z", celsius: 3 };

    for (const field of ["batchId", "sensorId"] as const) {
      for (const blank of ["", "   ", "\t"]) {
        assert.throws(
          () => canonicaliseReadings([{ ...reading, [field]: blank }]),
          new RegExp(`Missing required CSV field: ${field}`),
          `${field} = ${JSON.stringify(blank)}`
        );
      }
    }
  });

  // Surrounding whitespace has to go before the fingerprint is taken, or the same reading exported
  // twice hashes differently and a verification that should match reports tampering.
  it("trims the text it keeps, so the same reading always fingerprints the same", () => {
    const [canonical] = canonicaliseReadings([
      { batchId: "  B-1 ", sensorId: "\tS-1  ", recordedAt: " 2026-07-14T08:00:00Z ", celsius: 3 }
    ]);

    assert.equal(canonical.batchId, "B-1");
    assert.equal(canonical.sensorId, "S-1");
    assert.equal(canonical.recordedAt, "2026-07-14T08:00:00.000Z");
  });

  it("refuses a temperature that is not a finite number", () => {
    for (const celsius of [Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(
        () =>
          canonicaliseReadings([
            { batchId: "B-1", sensorId: "S-1", recordedAt: "2026-07-14T08:00:00Z", celsius }
          ]),
        /Invalid celsius value/,
        String(celsius)
      );
    }
  });
});
