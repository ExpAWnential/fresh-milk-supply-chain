/**
 * Parses a signed CSV export produced by a sensor-side process.
 *
 * Sensor identity, sequence and signature are required fields. The parser refuses incomplete rows
 * instead of filling defaults that would make a broken or altered run look valid.
 */
import { readFile } from "node:fs/promises";
import { RawTemperatureReading } from "./canonicalise.js";

export const REQUIRED_HEADERS = [
  "batchId",
  "sensorId",
  "sequence",
  "recordedAt",
  "celsius",
  "signature"
] as const;

/** Reads a signed sensor CSV file and rejects it if any required row data is incomplete. */
export async function readTemperatureReadingsCsv(
  filePath: string
): Promise<readonly RawTemperatureReading[]> {
  const csv = await readFile(filePath, "utf8");
  return parseTemperatureReadingsCsv(csv);
}

/** Parses signed readings without inventing defaults for missing identity or signature fields. */
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
      throw new Error(
        `CSV row ${index + 2} has ${values.length} values but expected ${headers.length}.`
      );
    }

    const row = Object.fromEntries(
      headers.map((header, columnIndex) => [header, values[columnIndex]])
    );
    const celsius = Number(row.celsius);

    if (!Number.isFinite(celsius)) {
      throw new Error(`CSV row ${index + 2} has invalid celsius value: ${row.celsius}`);
    }

    const sequence = Number(row.sequence);
    if (!Number.isSafeInteger(sequence) || sequence < 1) {
      throw new Error(`CSV row ${index + 2} has invalid sequence value: ${row.sequence}`);
    }
    if (!row.signature) {
      throw new Error(`CSV row ${index + 2} has no signature.`);
    }

    return {
      batchId: row.batchId,
      sensorId: row.sensorId,
      sequence,
      recordedAt: row.recordedAt,
      celsius,
      signature: row.signature
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
