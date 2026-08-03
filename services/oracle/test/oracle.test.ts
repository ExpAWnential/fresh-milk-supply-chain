import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sha256TemperatureReadings } from "@fresh-milk/storage";
import { canonicaliseReadings, type RawTemperatureReading } from "../src/canonicalise.js";
import { calculateTemperatureStatistics as calculateStatistics } from "@fresh-milk/storage";
import { assessCompliance } from "../src/compliance.js";
import { parseTemperatureReadingsCsv } from "../src/csvReader.js";

// Signature authenticity is covered in verifyReadings.test.ts.
const SIG = "c2lnbmF0dXJl";

function raw(overrides: Partial<RawTemperatureReading> = {}): RawTemperatureReading {
  return {
    batchId: "BATCH-001",
    sensorId: "SENSOR-001",
    sequence: 1,
    recordedAt: "2026-07-14T08:00:00Z",
    celsius: 3.2,
    signature: SIG,
    ...overrides
  };
}

describe("temperature oracle", () => {
  it("parses sensor readings from CSV", () => {
    const readings = parseTemperatureReadingsCsv(
      `batchId,sensorId,sequence,recordedAt,celsius,signature
BATCH-001,SENSOR-001,1,2026-07-14T08:00:00Z,3.2,${SIG}
BATCH-001,SENSOR-001,2,2026-07-14T08:15:00Z,3.6,${SIG}`
    );

    assert.deepEqual(readings, [
      raw(),
      raw({ sequence: 2, recordedAt: "2026-07-14T08:15:00Z", celsius: 3.6 })
    ]);
  });

  it("rejects missing required CSV headers", () => {
    assert.throws(
      () =>
        parseTemperatureReadingsCsv(`batchId,sensorId,sequence,recordedAt,signature
BATCH-001,SENSOR-001,1,2026-07-14T08:00:00Z,sig`),
      /missing required header: celsius/
    );
  });

  it("canonicalises readings into deterministic order", () => {
    const canonicalReadings = canonicaliseReadings([
      raw({
        batchId: " BATCH-001 ",
        sensorId: "SENSOR-002",
        sequence: 2,
        recordedAt: "2026-07-14T08:15:00+00:00",
        celsius: 3.55555
      }),
      raw()
    ]);

    assert.deepEqual(canonicalReadings, [
      {
        batchId: "BATCH-001",
        sensorId: "SENSOR-001",
        sequence: 1,
        recordedAt: "2026-07-14T08:00:00.000Z",
        celsius: 3.2,
        signature: SIG
      },
      {
        batchId: "BATCH-001",
        sensorId: "SENSOR-002",
        sequence: 2,
        recordedAt: "2026-07-14T08:15:00.000Z",
        celsius: 3.556,
        signature: SIG
      }
    ]);
  });

  it("calculates min, max and count", () => {
    const readings = canonicaliseReadings([
      raw(),
      raw({ sequence: 2, recordedAt: "2026-07-14T08:15:00Z", celsius: 3.6 }),
      raw({ sequence: 3, recordedAt: "2026-07-14T08:30:00Z", celsius: 3.4 })
    ]);

    assert.deepEqual(calculateStatistics(readings), {
      minCelsius: 3.2,
      maxCelsius: 3.6,
      readingCount: 3
    });
  });

  it("produces the same fingerprint for the same readings in different order", () => {
    const readings = [
      raw(),
      raw({ sequence: 2, recordedAt: "2026-07-14T08:15:00Z", celsius: 3.6 })
    ];
    const strip = (list: readonly { sensorId: string; recordedAt: string; celsius: number }[]) =>
      list.map(({ sensorId, recordedAt, celsius }) => ({ sensorId, recordedAt, celsius }));

    assert.equal(
      sha256TemperatureReadings("BATCH-001", strip(canonicaliseReadings(readings))),
      sha256TemperatureReadings("BATCH-001", strip(canonicaliseReadings([...readings].reverse())))
    );
  });

  // Fingerprints cover measurements. Signatures separately cover source and sequence.
  it("fingerprints the same whatever the signature says", () => {
    const strip = (list: readonly { sensorId: string; recordedAt: string; celsius: number }[]) =>
      list.map(({ sensorId, recordedAt, celsius }) => ({ sensorId, recordedAt, celsius }));

    assert.equal(
      sha256TemperatureReadings("BATCH-001", strip(canonicaliseReadings([raw()]))),
      sha256TemperatureReadings(
        "BATCH-001",
        strip(canonicaliseReadings([raw({ signature: "ZGlmZmVyZW50", sequence: 9 })]))
      )
    );
  });

  it("marks readings above the cold-chain threshold as unsafe", () => {
    const readings = canonicaliseReadings([
      raw({ batchId: "BATCH-002", sensorId: "SENSOR-002", celsius: 4.1 }),
      raw({
        batchId: "BATCH-002",
        sensorId: "SENSOR-002",
        sequence: 2,
        recordedAt: "2026-07-14T08:15:00Z",
        celsius: 8.9
      })
    ]);

    assert.equal(assessCompliance(calculateStatistics(readings)), "UNSAFE");
  });

  it("applies the same 0-5C range as the on-chain contract", () => {
    assert.equal(assessCompliance({ minCelsius: 0, maxCelsius: 5, readingCount: 2 }), "COMPLIANT");
    assert.equal(assessCompliance({ minCelsius: -0.1, maxCelsius: 3, readingCount: 2 }), "UNSAFE");
    assert.equal(assessCompliance({ minCelsius: 3, maxCelsius: 5.1, readingCount: 2 }), "UNSAFE");
  });

  it("refuses to calculate statistics for no readings at all", () => {
    assert.throws(() => calculateStatistics([]), /empty reading set/);
  });

  it("refuses a timestamp it cannot read", () => {
    assert.throws(
      () => canonicaliseReadings([raw({ recordedAt: "last tuesday" })]),
      /Invalid temperature reading timestamp 'last tuesday'/
    );
  });

  it("refuses a reading with no batch, sensor or signature, naming the field", () => {
    for (const field of ["batchId", "sensorId", "signature"] as const) {
      for (const blank of ["", "   ", "\t"]) {
        assert.throws(
          () => canonicaliseReadings([raw({ [field]: blank })]),
          new RegExp(`${field} must not be empty`),
          `${field} = ${JSON.stringify(blank)}`
        );
      }
    }
  });

  it("trims the text it keeps, so the same reading always fingerprints the same", () => {
    const [canonical] = canonicaliseReadings([
      raw({
        batchId: "  B-1 ",
        sensorId: "\tS-1  ",
        recordedAt: " 2026-07-14T08:00:00Z ",
        celsius: 3,
        signature: `  ${SIG} `
      })
    ]);

    assert.equal(canonical.batchId, "B-1");
    assert.equal(canonical.sensorId, "S-1");
    assert.equal(canonical.recordedAt, "2026-07-14T08:00:00.000Z");
    // Sensor IDs share the signed payload's trimming rule.
    assert.equal(canonical.signature, SIG);
  });

  it("refuses a temperature that is not a finite number", () => {
    for (const celsius of [Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(
        () => canonicaliseReadings([raw({ celsius })]),
        /Invalid celsius value/,
        String(celsius)
      );
    }
  });
});
