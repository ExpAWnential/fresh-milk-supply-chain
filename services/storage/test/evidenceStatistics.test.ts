import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateTemperatureStatistics } from "../src/evidenceStatistics.js";

// Oracle submission and later verification must produce exactly the same summary.
describe("summarising a set of readings", () => {
  it("reports the range and how many readings there were", () => {
    assert.deepEqual(
      calculateTemperatureStatistics([{ celsius: 1 }, { celsius: 5 }, { celsius: 3 }]),
      { minCelsius: 1, maxCelsius: 5, readingCount: 3 }
    );
  });

  it("summarises a single reading as its own range", () => {
    assert.deepEqual(calculateTemperatureStatistics([{ celsius: 2.5 }]), {
      minCelsius: 2.5,
      maxCelsius: 2.5,
      readingCount: 1
    });
  });

  // Negative input catches an incorrect minimum initialised to zero.
  it("handles readings below zero", () => {
    assert.deepEqual(calculateTemperatureStatistics([{ celsius: -1.5 }, { celsius: 4 }]), {
      minCelsius: -1.5,
      maxCelsius: 4,
      readingCount: 2
    });
  });

  it("keeps a rounded reading a number rather than a fixed-width string", () => {
    const statistics = calculateTemperatureStatistics([{ celsius: 2.5 }, { celsius: 3 }]);

    assert.equal(statistics.minCelsius, 2.5);
  });

  it("rounds the range to three decimals", () => {
    const statistics = calculateTemperatureStatistics([
      { celsius: 1.00049 },
      { celsius: 4.99951 }
    ]);

    assert.equal(statistics.minCelsius, 1);
    assert.equal(statistics.maxCelsius, 5);
  });

  it("refuses an empty reading set rather than inventing a summary of it", () => {
    assert.throws(
      () => calculateTemperatureStatistics([]),
      /Cannot calculate statistics for an empty reading set/
    );
  });

  it("does not depend on the order the readings arrive in", () => {
    const readings = [{ celsius: 4.2 }, { celsius: 1.1 }, { celsius: 3.3 }];

    assert.deepEqual(
      calculateTemperatureStatistics(readings),
      calculateTemperatureStatistics([...readings].reverse())
    );
  });

  // Large input protects against spreading every value into Math.min or Math.max.
  it("summarises a full day of minute-by-minute readings", () => {
    const readings = Array.from({ length: 1_440 }, (_unused, minute) => ({
      celsius: 2 + (minute % 3) / 10
    }));

    const statistics = calculateTemperatureStatistics(readings);

    assert.equal(statistics.readingCount, 1_440);
    assert.equal(statistics.minCelsius, 2);
    assert.equal(statistics.maxCelsius, 2.2);
  });
});
