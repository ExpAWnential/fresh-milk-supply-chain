import {
  canonicaliseReadings,
  serialiseCanonicalReadings
} from "./canonicalise.js";
import { assessCompliance, calculateStatistics } from "./compliance.js";
import { readTemperatureReadingsCsv } from "./csvReader.js";
import { hashCanonicalEvidence } from "./hash.js";

const inputPath = process.argv[2] ?? "data/compliant-readings.csv";

try {
  const readings = await readTemperatureReadingsCsv(inputPath);
  const canonicalReadings = canonicaliseReadings(readings);
  const canonicalJson = serialiseCanonicalReadings(canonicalReadings);
  const statistics = calculateStatistics(canonicalReadings);
  const evidenceHash = hashCanonicalEvidence(canonicalJson);
  const complianceOutcome = assessCompliance(statistics);

  console.log(JSON.stringify(
    {
      inputPath,
      readingCount: statistics.readingCount,
      statistics,
      complianceOutcome,
      evidenceHash,
      canonicalReadings
    },
    null,
    2
  ));
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown oracle error";
  console.error(`oracle failed: ${message}`);
  process.exitCode = 1;
}
