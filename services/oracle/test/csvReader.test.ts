import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { parseTemperatureReadingsCsv, readTemperatureReadingsCsv } from "../src/csvReader.js";

const HEADER = "batchId,sensorId,recordedAt,celsius";

describe("reading sensor CSV", () => {
  it("keeps the columns in whatever order the file gives them", () => {
    const readings = parseTemperatureReadingsCsv(
      ["celsius,recordedAt,sensorId,batchId", "3.2,2026-07-14T08:00:00Z,SENSOR-1,BATCH-1"].join("\n")
    );

    assert.deepEqual(readings, [
      {
        batchId: "BATCH-1",
        sensorId: "SENSOR-1",
        recordedAt: "2026-07-14T08:00:00Z",
        celsius: 3.2
      }
    ]);
  });

  it("ignores blank lines and surrounding whitespace", () => {
    const readings = parseTemperatureReadingsCsv(
      ["", `  ${HEADER}  `, "  BATCH-1 , SENSOR-1 , 2026-07-14T08:00:00Z , 3.2 ", "", ""].join("\r\n")
    );

    assert.equal(readings.length, 1);
    assert.equal(readings[0].batchId, "BATCH-1");
    assert.equal(readings[0].celsius, 3.2);
  });

  // A truncated export is the likeliest way a sensor file arrives broken, and silently anchoring
  // a partial row would put a fingerprint on the ledger that covers the wrong readings.
  it("refuses a row with the wrong number of values, naming the line", () => {
    assert.throws(
      () => parseTemperatureReadingsCsv([HEADER, "BATCH-1,SENSOR-1,2026-07-14T08:00:00Z"].join("\n")),
      /row 2 has 3 values but expected 4/
    );
  });

  it("refuses a temperature that is not a number, naming the line", () => {
    assert.throws(
      () =>
        parseTemperatureReadingsCsv(
          [HEADER, "BATCH-1,SENSOR-1,2026-07-14T08:00:00Z,3.2", "BATCH-1,SENSOR-1,2026-07-14T08:15:00Z,warm"].join("\n")
        ),
      /row 3 has invalid celsius value: warm/
    );
  });

  it("refuses a file with no reading rows", () => {
    for (const csv of ["", HEADER, `${HEADER}\n\n`]) {
      assert.throws(
        () => parseTemperatureReadingsCsv(csv),
        /header and at least one reading row/,
        JSON.stringify(csv)
      );
    }
  });

  it("names the header that is missing", () => {
    assert.throws(
      () => parseTemperatureReadingsCsv(["batchId,sensorId,celsius", "BATCH-1,SENSOR-1,3.2"].join("\n")),
      /missing required header: recordedAt/
    );
  });

  it("reads the same rows from a file on disk", async () => {
    const directory = await mkdtemp(join(tmpdir(), "oracle-csv-"));
    const path = join(directory, "readings.csv");
    const csv = [HEADER, "BATCH-1,SENSOR-1,2026-07-14T08:00:00Z,3.2"].join("\n");
    await writeFile(path, csv, "utf8");

    assert.deepEqual(await readTemperatureReadingsCsv(path), parseTemperatureReadingsCsv(csv));
  });
});
