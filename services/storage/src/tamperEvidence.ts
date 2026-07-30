import { pathToFileURL } from "node:url";
import type { Pool } from "pg";
import { createPool } from "./pool.js";
import { sha256TemperatureReadings } from "./evidenceHash.js";
import {
  createTemperatureRepository,
  type TemperatureRepository
} from "./repositories/temperatureRepository.js";

export interface TamperArguments {
  readonly evidenceId: string;
  readonly deltaCelsius: number;
  readonly confirmed: boolean;
}

function readOption(argumentsList: readonly string[], name: string): string | undefined {
  const index = argumentsList.indexOf(name);
  return index >= 0 ? argumentsList[index + 1] : undefined;
}

export function parseArguments(argumentsList: readonly string[]): TamperArguments {
  const evidenceId = readOption(argumentsList, "--evidence")?.trim();
  if (!evidenceId) {
    throw new Error(
      "Usage: pnpm demo:tamper -- --evidence <ID> [--delta <celsius>] --confirm-tamper"
    );
  }

  const deltaCelsius = Number(readOption(argumentsList, "--delta") ?? "1");
  if (!Number.isFinite(deltaCelsius) || Math.abs(deltaCelsius) < 0.01) {
    throw new Error("Tamper delta must be a finite change of at least 0.01°C.");
  }

  return {
    evidenceId,
    deltaCelsius,
    confirmed: argumentsList.includes("--confirm-tamper")
  };
}

export interface ChangedReading {
  readonly reading_id: string;
  readonly old_celsius: string;
  readonly new_celsius: string;
}

export interface TamperDependencies {
  readonly repository: TemperatureRepository;
  // Alters the earliest reading and reports what it changed. Separate from the checks around it
  // so the refusals below can be exercised without a database.
  readonly alterEarliestReading: (
    evidenceId: string,
    deltaCelsius: number
  ) => Promise<ChangedReading | undefined>;
}

// Refuses unless the evidence is anchored and currently verifies, because the point of the demo is
// to show a match turning into a mismatch. Tampering with something already broken shows nothing.
export async function tamperWithEvidence(
  options: TamperArguments,
  dependencies: TamperDependencies
): Promise<Record<string, unknown>> {
  if (!options.confirmed) {
    throw new Error(
      "Refusing to modify a reading without --confirm-tamper. This command intentionally changes demo data."
    );
  }

  const evidence = await dependencies.repository.getEvidence(options.evidenceId);
  if (!evidence) {
    throw new Error(`Evidence '${options.evidenceId}' does not exist.`);
  }
  if (evidence.submissionStatus !== "ANCHORED" || !evidence.fabricTransactionId) {
    throw new Error(`Evidence '${options.evidenceId}' is not anchored to Fabric.`);
  }

  const readingsBefore = await dependencies.repository.getReadings(options.evidenceId);
  const hashBefore = sha256TemperatureReadings(evidence.batchId, readingsBefore);
  if (hashBefore !== evidence.evidenceHash) {
    throw new Error(
      "Evidence already fails verification; reset or reseed the demo before tampering."
    );
  }

  const changedReading = await dependencies.alterEarliestReading(
    options.evidenceId,
    options.deltaCelsius
  );
  if (!changedReading) {
    throw new Error(`Evidence '${options.evidenceId}' has no readings to modify.`);
  }

  const readingsAfter = await dependencies.repository.getReadings(options.evidenceId);
  const hashAfter = sha256TemperatureReadings(evidence.batchId, readingsAfter);

  return {
    evidenceId: options.evidenceId,
    fabricTransactionId: evidence.fabricTransactionId,
    changedReading,
    anchoredHash: evidence.evidenceHash,
    before: { recomputedHash: hashBefore, result: "MATCH" },
    after: {
      recomputedHash: hashAfter,
      result: hashAfter === evidence.evidenceHash ? "MATCH" : "HASH_MISMATCH"
    }
  };
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const connectionString =
    process.env.DATABASE_URL ?? "postgres://freshmilk:freshmilk@localhost:5432/freshmilk";
  const pool = createPool({ connectionString });

  try {
    const report = await tamperWithEvidence(options, {
      repository: createTemperatureRepository(pool),
      alterEarliestReading: (evidenceId, deltaCelsius) =>
        alterEarliestReading(pool, evidenceId, deltaCelsius)
    });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await pool.end();
  }
}

async function alterEarliestReading(
  pool: Pool,
  evidenceId: string,
  deltaCelsius: number
): Promise<ChangedReading | undefined> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<ChangedReading>(
      `WITH target AS (
         SELECT reading_id, celsius
         FROM temperature_readings
         WHERE evidence_id = $1
         ORDER BY recorded_at ASC, sensor_id ASC, reading_id ASC
         LIMIT 1
         FOR UPDATE
       )
       UPDATE temperature_readings AS reading
       SET celsius = target.celsius + $2
       FROM target
       WHERE reading.reading_id = target.reading_id
       RETURNING
         reading.reading_id::text,
         target.celsius::text AS old_celsius,
         reading.celsius::text AS new_celsius`,
      [evidenceId, deltaCelsius]
    );
    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// Only run when invoked as a command. Importing the module, as the tests do, must not connect to
// a database or start modifying rows.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[tamper-demo] ${message}`);
    process.exitCode = 1;
  });
}
