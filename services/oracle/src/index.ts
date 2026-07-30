import {
  createPool,
  createTemperatureRepository,
  sha256TemperatureReadings,
  type StoredTemperatureReading
} from "@fresh-milk/storage";
import { canonicaliseReadings } from "./canonicalise.js";
import { assessCompliance, calculateStatistics } from "./compliance.js";
import { readTemperatureReadingsCsv } from "./csvReader.js";
import { submitTemperatureEvidence } from "./oracleClient.js";

const inputPath = process.argv[2] ?? "data/compliant-readings.csv";
const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://freshmilk:freshmilk@localhost:5432/freshmilk";

// Every reading in one run must describe the same batch, otherwise the fingerprint would cover
// readings from several batches and could never be verified against a single ledger record.
function singleBatchId(batchIds: readonly string[]): string {
  const unique = [...new Set(batchIds)];
  if (unique.length !== 1) {
    throw new Error(
      `Readings must all belong to one batch, found: ${unique.join(", ") || "none"}.`
    );
  }
  return unique[0];
}

const pool = createPool({ connectionString: databaseUrl });
const repository = createTemperatureRepository(pool);

try {
  const canonicalReadings = canonicaliseReadings(await readTemperatureReadingsCsv(inputPath));
  const batchId = singleBatchId(canonicalReadings.map((reading) => reading.batchId));
  const statistics = calculateStatistics(canonicalReadings);

  const readings: readonly StoredTemperatureReading[] = canonicalReadings.map((reading) => ({
    sensorId: reading.sensorId,
    recordedAt: reading.recordedAt,
    celsius: reading.celsius
  }));

  // Hashed with the storage package's function, the same one verification and the tamper demo
  // use, so the three can never disagree about what the fingerprint covers.
  const evidenceHash = sha256TemperatureReadings(batchId, readings);

  // Derived from the content so the same readings always produce the same ID, and resubmitting
  // them is rejected as a duplicate rather than silently anchored twice.
  const evidenceId = `EV-${batchId}-${evidenceHash.slice(0, 8)}`;

  // Saved before anchoring and left PENDING, so a failed submission is never mistaken for
  // evidence that made it onto the ledger.
  await repository.saveEvidence(
    {
      evidenceId,
      batchId,
      sensorId: readings[0].sensorId,
      evidenceHash,
      minCelsius: statistics.minCelsius,
      maxCelsius: statistics.maxCelsius,
      averageCelsius: statistics.averageCelsius,
      readingCount: statistics.readingCount,
      complianceOutcome: assessCompliance(statistics),
      submissionStatus: "PENDING",
      fabricTransactionId: null
    },
    readings
  );

  try {
    const anchored = await submitTemperatureEvidence({
      evidenceId,
      batchId,
      evidenceHash,
      offChainReference: `postgres://temperature_evidence/${evidenceId}`,
      statistics
    });
    await repository.markAnchored(evidenceId, anchored.submittedTxId);

    console.log(
      JSON.stringify(
        {
          evidenceId,
          batchId,
          readingCount: statistics.readingCount,
          statistics,
          evidenceHash,
          // Reported by the contract, not by this process.
          complianceOutcome: anchored.complianceOutcome,
          fabricTransactionId: anchored.submittedTxId
        },
        null,
        2
      )
    );
  } catch (error) {
    await repository.markFailed(evidenceId);
    throw error;
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown oracle error";
  console.error(`oracle failed: ${message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
