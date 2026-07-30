import { createPool, createTemperatureRepository } from "@fresh-milk/storage";
import { readTemperatureReadingsCsv } from "./csvReader.js";
import { submitTemperatureEvidence } from "./oracleClient.js";
import { runOracle } from "./runOracle.js";

const inputPath = process.argv[2] ?? "data/compliant-readings.csv";
const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://freshmilk:freshmilk@localhost:5432/freshmilk";

const pool = createPool({ connectionString: databaseUrl });

try {
  const result = await runOracle(await readTemperatureReadingsCsv(inputPath), {
    repository: createTemperatureRepository(pool),
    anchor: submitTemperatureEvidence
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown oracle error";
  console.error(`oracle failed: ${message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
