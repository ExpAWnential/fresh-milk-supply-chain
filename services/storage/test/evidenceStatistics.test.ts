import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateTemperatureStatistics } from "../src/evidenceStatistics.js";

// The oracle computes these before anchoring and verification recomputes them afterwards to check
// the anchored copy was honest. The two sides compare exactly, with no tolerance, so anything that
// makes the same readings summarise differently twice reports a lie where there was none.
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

  // Milk is stored below zero nowhere in this system, but a sensor reporting it is exactly the case
  // a naive minimum would get wrong.
  it("handles readings below zero", () => {
    assert.deepEqual(calculateTemperatureStatistics([{ celsius: -1.5 }, { celsius: 4 }]), {
      minCelsius: -1.5,
      maxCelsius: 4,
      readingCount: 2
    });
  });

  it("keeps a rounded reading a number rather than a fixed-width string", () => {
    const statistics = calculateTemperatureStatistics([{ celsius: 2.5 }, { celsius: 3 }]);

    // Strict equality, so toFixed's "2.500" fails here: it reads the same and compares as unequal.
    assert.equal(statistics.minCelsius, 2.5);
  });

  // Three decimals, matching what the canonical form of a reading carries, so an anchored minimum
  // matches a recomputed one exactly rather than the two sides having to agree on floating point
  // noise.
  it("rounds the range to three decimals", () => {
    const statistics = calculateTemperatureStatistics([
      { celsius: 1.00049 },
      { celsius: 4.99951 }
    ]);

    assert.equal(statistics.minCelsius, 1);
    assert.equal(statistics.maxCelsius, 5);
  });

  // There is nothing to summarise, and returning zeroes would put a summary on the ledger claiming
  // a batch was held at 0 °C when nothing was ever measured.
  it("refuses an empty reading set rather than inventing a summary of it", () => {
    assert.throws(
      () => calculateTemperatureStatistics([]),
      /Cannot calculate statistics for an empty reading set/
    );
  });

  // The same readings in a different order describe the same conditions, and the readings are
  // sorted before hashing, so a summary that depended on order could not be recomputed.
  it("does not depend on the order the readings arrive in", () => {
    const readings = [{ celsius: 4.2 }, { celsius: 1.1 }, { celsius: 3.3 }];

    assert.deepEqual(
      calculateTemperatureStatistics(readings),
      calculateTemperatureStatistics([...readings].reverse())
    );
  });

  // A reading set large enough to have blown the stack, because the minimum and maximum are taken
  // by spreading the values into Math.min.
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
