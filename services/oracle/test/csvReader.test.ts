import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { parseTemperatureReadingsCsv, readTemperatureReadingsCsv } from "../src/csvReader.js";

const HEADER = "batchId,sensorId,sequence,recordedAt,celsius,signature";
// Base64, so it carries "+" and "/" and "=" but never a comma. That is what lets the parser stay a
// plain split on commas.
const SIGNATURE = "1nIsei2x6OOfyJgrM2anyP23G+rGIah6RcIRyA2kNJuMSwc3xLqic/wxL1LgIJGLJHCaa7Qla==";
const ROW = `BATCH-1,SENSOR-1,1,2026-07-14T08:00:00Z,3.2,${SIGNATURE}`;

describe("reading sensor CSV", () => {
  it("keeps the columns in whatever order the file gives them", () => {
    const readings = parseTemperatureReadingsCsv(
      [
        "celsius,signature,recordedAt,sequence,sensorId,batchId",
        `3.2,${SIGNATURE},2026-07-14T08:00:00Z,1,SENSOR-1,BATCH-1`
      ].join("\n")
    );

    assert.deepEqual(readings, [
      {
        batchId: "BATCH-1",
        sensorId: "SENSOR-1",
        sequence: 1,
        recordedAt: "2026-07-14T08:00:00Z",
        celsius: 3.2,
        signature: SIGNATURE
      }
    ]);
  });

  it("ignores blank lines and surrounding whitespace", () => {
    const readings = parseTemperatureReadingsCsv(
      [
        "",
        `  ${HEADER}  `,
        `  BATCH-1 , SENSOR-1 , 1 , 2026-07-14T08:00:00Z , 3.2 , ${SIGNATURE} `,
        "",
        ""
      ].join("\r\n")
    );

    assert.equal(readings.length, 1);
    assert.equal(readings[0].batchId, "BATCH-1");
    assert.equal(readings[0].celsius, 3.2);
    // Trimmed, or it would not match the bytes the sensor signed.
    assert.equal(readings[0].signature, SIGNATURE);
  });

  // A truncated export is the likeliest way a sensor file arrives broken, and silently anchoring
  // a partial row would put a fingerprint on the ledger that covers the wrong readings.
  it("refuses a row with the wrong number of values, naming the line", () => {
    assert.throws(
      () =>
        parseTemperatureReadingsCsv([HEADER, "BATCH-1,SENSOR-1,1,2026-07-14T08:00:00Z"].join("\n")),
      /row 2 has 4 values but expected 6/
    );
  });

  it("refuses a temperature that is not a number, naming the line", () => {
    assert.throws(
      () =>
        parseTemperatureReadingsCsv(
          [HEADER, ROW, `BATCH-1,SENSOR-1,2,2026-07-14T08:15:00Z,warm,${SIGNATURE}`].join("\n")
        ),
      /row 3 has invalid celsius value: warm/
    );
  });

  // The sequence is what makes a removed reading visible, so a file that cannot supply a usable one
  // has to be refused rather than defaulted to its row position.
  it("refuses a sequence that is not a positive whole number, naming the line", () => {
    for (const sequence of ["0", "-1", "1.5", "first", ""]) {
      assert.throws(
        () =>
          parseTemperatureReadingsCsv(
            [HEADER, `BATCH-1,SENSOR-1,${sequence},2026-07-14T08:00:00Z,3.2,${SIGNATURE}`].join(
              "\n"
            )
          ),
        /row 2 has invalid sequence value/,
        `sequence '${sequence}'`
      );
    }
  });

  // Accepting an unsigned reading would quietly reopen the gap the signatures exist to close, so
  // it is refused at the parser rather than left for a verifier that might not run.
  it("refuses a reading with no signature", () => {
    assert.throws(
      () =>
        parseTemperatureReadingsCsv(
          [HEADER, "BATCH-1,SENSOR-1,1,2026-07-14T08:00:00Z,3.2,"].join("\n")
        ),
      /row 2 has no signature/
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
      () =>
        parseTemperatureReadingsCsv(
          ["batchId,sensorId,celsius", "BATCH-1,SENSOR-1,3.2"].join("\n")
        ),
      /missing required header: sequence/
    );
    assert.throws(
      () =>
        parseTemperatureReadingsCsv(
          ["batchId,sensorId,sequence,recordedAt,celsius", "BATCH-1,SENSOR-1,1,x,3.2"].join("\n")
        ),
      /missing required header: signature/
    );
  });

  it("reads the same rows from a file on disk", async () => {
    const directory = await mkdtemp(join(tmpdir(), "oracle-csv-"));
    const path = join(directory, "readings.csv");
    const csv = [HEADER, ROW].join("\n");
    await writeFile(path, csv, "utf8");

    assert.deepEqual(await readTemperatureReadingsCsv(path), parseTemperatureReadingsCsv(csv));
  });
});
