/**
 * Reads sensor readings out of a CSV file.
 *
 * Parsing only. Nothing here reshapes or judges a reading beyond checking that the columns are
 * present and the temperature is a number.
 */
import { readFile } from "node:fs/promises";
import { RawTemperatureReading } from "./canonicalise.js";

const REQUIRED_HEADERS = ["batchId", "sensorId", "recordedAt", "celsius"] as const;

export async function readTemperatureReadingsCsv(
  filePath: string
): Promise<readonly RawTemperatureReading[]> {
  const csv = await readFile(filePath, "utf8");
  return parseTemperatureReadingsCsv(csv);
}

export function parseTemperatureReadingsCsv(csv: string): readonly RawTemperatureReading[] {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) {
    throw new Error("CSV must include a header and at least one reading row.");
  }

  const headers = splitCsvLine(lines[0]);
  assertRequiredHeaders(headers);

  return lines.slice(1).map((line, index) => {
    const values = splitCsvLine(line);

    if (values.length !== headers.length) {
      throw new Error(`CSV row ${index + 2} has ${values.length} values but expected ${headers.length}.`);
    }

    const row = Object.fromEntries(headers.map((header, columnIndex) => [header, values[columnIndex]]));
    const celsius = Number(row.celsius);

    if (!Number.isFinite(celsius)) {
      throw new Error(`CSV row ${index + 2} has invalid celsius value: ${row.celsius}`);
    }

    return {
      batchId: row.batchId,
      sensorId: row.sensorId,
      recordedAt: row.recordedAt,
      celsius
    };
  });
}

function assertRequiredHeaders(headers: readonly string[]): void {
  for (const requiredHeader of REQUIRED_HEADERS) {
    if (!headers.includes(requiredHeader)) {
      throw new Error(`CSV is missing required header: ${requiredHeader}`);
    }
  }
}

function splitCsvLine(line: string): string[] {
  return line.split(",").map((value) => value.trim());
}
