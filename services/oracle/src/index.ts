/**
 * `pnpm oracle:dev`. Reads a readings file, runs the oracle against the real backend and database,
 * and prints the result.
 */
import { createPool, createTemperatureRepository, ORACLE_DATABASE_URL } from "@fresh-milk/storage";
import { readTemperatureReadingsCsv } from "./csvReader.js";
import {
  readAnchoredEvidence,
  readSensorPublicKey,
  submitTemperatureEvidence
} from "./oracleClient.js";
import { runOracle } from "./runOracle.js";
import { verifyReadings } from "./verifyReadings.js";

const inputPath = process.argv[2] ?? "data/compliant-readings.csv";
const databaseUrl = process.env.DATABASE_URL ?? ORACLE_DATABASE_URL;

const pool = createPool({ connectionString: databaseUrl });

try {
  const result = await runOracle(await readTemperatureReadingsCsv(inputPath), {
    repository: createTemperatureRepository(pool),
    anchor: submitTemperatureEvidence,
    readAnchored: readAnchoredEvidence,
    // The key is fetched from the ledger through this oracle's own backend, not read from the file
    // beside the readings.
    verifyReadings: (readings) => verifyReadings(readings, readSensorPublicKey)
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown oracle error";
  console.error(`oracle failed: ${message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
