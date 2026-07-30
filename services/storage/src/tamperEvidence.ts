import { pathToFileURL } from "node:url";
import { createPool } from "./pool.js";
import { sha256TemperatureReadings } from "./evidenceHash.js";
import { createTemperatureRepository } from "./repositories/temperatureRepository.js";

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

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  if (!options.confirmed) {
    throw new Error(
      "Refusing to modify a reading without --confirm-tamper. This command intentionally changes demo data."
    );
  }

  const connectionString =
    process.env.DATABASE_URL ?? "postgres://freshmilk:freshmilk@localhost:5432/freshmilk";
  const pool = createPool({ connectionString });
  const repository = createTemperatureRepository(pool);

  try {
    const evidence = await repository.getEvidence(options.evidenceId);
    if (!evidence) {
      throw new Error(`Evidence '${options.evidenceId}' does not exist.`);
    }
    if (evidence.submissionStatus !== "ANCHORED" || !evidence.fabricTransactionId) {
      throw new Error(`Evidence '${options.evidenceId}' is not anchored to Fabric.`);
    }

    const readingsBefore = await repository.getReadings(options.evidenceId);
    const hashBefore = sha256TemperatureReadings(evidence.batchId, readingsBefore);
    if (hashBefore !== evidence.evidenceHash) {
      throw new Error(
        "Evidence already fails verification; reset or reseed the demo before tampering."
      );
    }

    const client = await pool.connect();
    let changedReading:
      | { readonly reading_id: string; readonly old_celsius: string; readonly new_celsius: string }
      | undefined;

    try {
      await client.query("BEGIN");
      const result = await client.query<{
        reading_id: string;
        old_celsius: string;
        new_celsius: string;
      }>(
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
        [options.evidenceId, options.deltaCelsius]
      );
      changedReading = result.rows[0];
      if (!changedReading) {
        throw new Error(`Evidence '${options.evidenceId}' has no readings to modify.`);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const readingsAfter = await repository.getReadings(options.evidenceId);
    const hashAfter = sha256TemperatureReadings(evidence.batchId, readingsAfter);

    console.log(
      JSON.stringify(
        {
          evidenceId: options.evidenceId,
          fabricTransactionId: evidence.fabricTransactionId,
          changedReading,
          anchoredHash: evidence.evidenceHash,
          before: {
            recomputedHash: hashBefore,
            result: "MATCH"
          },
          after: {
            recomputedHash: hashAfter,
            result: hashAfter === evidence.evidenceHash ? "MATCH" : "HASH_MISMATCH"
          }
        },
        null,
        2
      )
    );
  } finally {
    await pool.end();
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
