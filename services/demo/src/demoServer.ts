/**
 * Provides isolated endpoints for exercising sensor signing, false summaries and database tampering.
 *
 * This process intentionally crosses trust boundaries that production services must preserve. It
 * holds the sensor's private key, writes directly to the oracle database and can submit a summary
 * that does not describe the stored readings. Keeping those capabilities in a separate package
 * prevents production code from gaining the same access.
 *
 *   POST /demo/run     sign readings, store them, anchor the fingerprint
 *   POST /demo/tamper  edit a stored reading directly in PostgreSQL, around the application
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ORACLE_DATABASE_URL,
  calculateTemperatureStatistics,
  createPool,
  createTemperatureRepository,
  sensorPublicKey,
  sha256TemperatureReadings,
  signReading,
  verifyReadingSignature,
  type SignableReading,
  type StoredTemperatureReading,
  type TemperatureStatistics
} from "@fresh-milk/storage";

const PORT = Number(process.env.DEMO_PORT ?? 3016);
const ORACLE_BACKEND = process.env.ORACLE_BACKEND_URL ?? "http://localhost:3006";
const SENSOR_ID = process.env.DEMO_SENSOR_ID ?? "SENSOR-001";

// The key remains in the sensor package rather than being copied into an oracle package.
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const keyDirectory = process.env.SENSOR_KEY_DIR ?? join(packageRoot, "..", "sensor", "data");

const pool = createPool({ connectionString: process.env.DATABASE_URL ?? ORACLE_DATABASE_URL });
const repository = createTemperatureRepository(pool);

interface RunRequest {
  readonly batchId: string;
  readonly readings: readonly { recordedAt: string; celsius: number }[];
  // Allows the submitted summary to differ from the readings stored under the same evidence hash.
  readonly lieAboutSummary?: boolean;
  readonly fakeStatistics?: { minCelsius: number; maxCelsius: number };
}

async function readPrivateKey(): Promise<string> {
  const path = join(keyDirectory, `${SENSOR_ID}.key`);
  try {
    return (await readFile(path, "utf8")).trim();
  } catch {
    throw new Error(
      `No private key for '${SENSOR_ID}' at ${path}. Run 'pnpm sensor:keygen' first.`
    );
  }
}

/**
 * Signs each reading with the sensor's private key before it reaches oracle-controlled storage.
 *
 * The timestamp is completed here rather than in the browser because the page only asks for a time
 * of day. The resulting signature fixes the original measurement before the oracle can store or
 * alter it.
 */
async function signAsSensor(
  batchId: string,
  readings: readonly { recordedAt: string; celsius: number }[]
): Promise<readonly StoredTemperatureReading[]> {
  const privateKey = await readPrivateKey();
  const today = new Date().toISOString().slice(0, 10);

  return readings.map((reading, index) => {
    const celsius = Number(reading.celsius);
    if (!Number.isFinite(celsius)) {
      throw new Error(`Reading ${index + 1} has an invalid temperature.`);
    }

    const recordedAt = /^\d\d:\d\d$/.test(reading.recordedAt)
      ? `${today}T${reading.recordedAt}:00Z`
      : String(reading.recordedAt);

    const signable: SignableReading = {
      batchId,
      sensorId: SENSOR_ID,
      sequence: index + 1,
      recordedAt,
      celsius
    };

    return {
      sensorId: SENSOR_ID,
      sequence: index + 1,
      recordedAt,
      celsius,
      signature: signReading(signable, privateKey)
    };
  });
}

/**
 * Applies the oracle's normal signature check before evidence is stored or submitted.
 *
 * This catches readings altered in transit, but it is not independent evidence because the oracle
 * controls whether the check runs. False-summary requests deliberately bypass it.
 */
async function verifyAsOracle(
  batchId: string,
  readings: readonly StoredTemperatureReading[]
): Promise<void> {
  const response = await fetch(`${ORACLE_BACKEND}/sensors/${encodeURIComponent(SENSOR_ID)}`);
  if (response.status === 404) {
    throw new Error(
      `Sensor '${SENSOR_ID}' has no key on the ledger. The regulator must register it first.`
    );
  }
  if (!response.ok) {
    throw new Error(`Could not read the sensor's key from the ledger (${response.status}).`);
  }

  const key = (await response.json()) as { publicKey: string; active: boolean };
  if (!key.active) {
    throw new Error(`Sensor '${SENSOR_ID}' has had its key revoked, so its readings are refused.`);
  }

  const publicKey = sensorPublicKey(key.publicKey);
  for (const reading of readings) {
    if (!verifyReadingSignature({ ...reading, batchId }, reading.signature, publicKey)) {
      throw new Error(
        `Reading ${reading.sequence} does not match its signature, so it was altered after the ` +
          `sensor recorded it. Nothing has been submitted.`
      );
    }
  }
}

/** Submits the evidence fingerprint and reported statistics through the oracle's fixed identity. */
async function anchorOnFabric(
  batchId: string,
  evidenceId: string,
  evidenceHash: string,
  statistics: TemperatureStatistics
): Promise<void> {
  const response = await fetch(
    `${ORACLE_BACKEND}/temperature/batches/${encodeURIComponent(batchId)}/evidence`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        evidenceId,
        evidenceHash,
        offChainReference: `postgres://temperature_evidence/${evidenceId}`,
        statistics
      })
    }
  );

  if (!response.ok) {
    const detail = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(detail.error ?? `The ledger refused the evidence (${response.status}).`);
  }
}

/** Signs and stores one reading set before anchoring either its real or supplied summary. */
async function handleRun(body: RunRequest): Promise<unknown> {
  const batchId = String(body.batchId ?? "").trim();
  if (!batchId) {
    throw new Error("'batchId' is required.");
  }
  if (!Array.isArray(body.readings) || body.readings.length === 0) {
    throw new Error("'readings' must contain at least one reading.");
  }

  const lying = body.lieAboutSummary === true;
  const stored = await signAsSensor(batchId, body.readings);

  if (!lying) {
    await verifyAsOracle(batchId, stored);
  }

  const honestStatistics = calculateTemperatureStatistics(stored);
  const evidenceHash = sha256TemperatureReadings(batchId, stored);
  const evidenceId = `EV-${batchId}-${evidenceHash.slice(0, 8)}`;

  // Fabric receives this summary separately from the hashed readings, so independent verification
  // must recompute it from storage.
  const reported: TemperatureStatistics =
    lying && body.fakeStatistics
      ? {
          minCelsius: Number(body.fakeStatistics.minCelsius),
          maxCelsius: Number(body.fakeStatistics.maxCelsius),
          readingCount: honestStatistics.readingCount
        }
      : honestStatistics;

  await repository.saveEvidence(
    {
      evidenceId,
      batchId,
      sensorId: SENSOR_ID,
      evidenceHash,
      minCelsius: honestStatistics.minCelsius,
      maxCelsius: honestStatistics.maxCelsius,
      readingCount: honestStatistics.readingCount,
      complianceOutcome: isSafe(honestStatistics) ? "COMPLIANT" : "UNSAFE",
      submissionStatus: "PENDING",
      fabricTransactionId: null
    },
    stored
  );

  await anchorOnFabric(batchId, evidenceId, evidenceHash, reported);

  const anchored = await fetch(
    `${ORACLE_BACKEND}/temperature/evidence/${encodeURIComponent(evidenceId)}`
  );
  const record = anchored.ok
    ? ((await anchored.json()) as { submittedTxId?: string; complianceOutcome?: string })
    : {};

  if (record.submittedTxId) {
    await repository.markAnchored(evidenceId, record.submittedTxId);
  }

  return {
    evidenceId,
    batchId,
    evidenceHash,
    readingCount: honestStatistics.readingCount,
    statistics: reported,
    honestStatistics,
    complianceOutcome: record.complianceOutcome ?? null,
    fabricTransactionId: record.submittedTxId ?? null,
    liedAboutSummary: lying
  };
}

// This local result records the oracle's view. Fabric derives the authoritative outcome itself.
function isSafe(statistics: TemperatureStatistics): boolean {
  return statistics.minCelsius >= 0 && statistics.maxCelsius <= 5;
}

/**
 * Changes one stored reading directly in PostgreSQL without using the repository's write path.
 *
 * Direct database access can alter the off-chain row, but it cannot replace the fingerprint already
 * committed to Fabric.
 */
async function handleTamper(body: { evidenceId?: unknown; celsius?: unknown }): Promise<unknown> {
  const evidenceId = String(body.evidenceId ?? "").trim();
  if (!evidenceId) {
    throw new Error("'evidenceId' is required.");
  }

  // Replace the value with a safe temperature so the mutation consistently hides a breach.
  const celsius = Number(body.celsius ?? 3.2);
  if (!Number.isFinite(celsius)) {
    throw new Error("'celsius' must be a number.");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Changing the warmest reading tests whether an apparent breach removal is detected.
    const result = await client.query<{
      sequence: number;
      old_celsius: string;
      new_celsius: string;
    }>(
      `WITH target AS (
         SELECT reading_id, celsius
         FROM temperature_readings
         WHERE evidence_id = $1
         ORDER BY celsius DESC, sequence ASC
         LIMIT 1
         FOR UPDATE
       )
       UPDATE temperature_readings AS reading
       SET celsius = $2
       FROM target
       WHERE reading.reading_id = target.reading_id
       RETURNING
         reading.sequence,
         target.celsius::text AS old_celsius,
         reading.celsius::text AS new_celsius`,
      [evidenceId, celsius]
    );
    await client.query("COMMIT");

    if (!result.rows[0]) {
      throw new Error(`Evidence '${evidenceId}' has no stored readings to change.`);
    }
    return { evidenceId, changedReading: result.rows[0] };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function send(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json",
    // Any consortium backend may serve the console that calls this local helper.
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  res.end(JSON.stringify(payload));
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

const server = createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    send(response, 204, {});
    return;
  }

  try {
    const body = await readJson(request);
    if (request.method === "POST" && request.url === "/demo/run") {
      send(response, 201, await handleRun(body as unknown as RunRequest));
      return;
    }
    if (request.method === "POST" && request.url === "/demo/tamper") {
      send(response, 200, await handleTamper(body));
      return;
    }
    send(response, 404, { error: "Unknown route. POST /demo/run or POST /demo/tamper." });
  } catch (error) {
    send(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(PORT, () => {
  console.log(`[demo] listening on ${PORT} — POST /demo/run, POST /demo/tamper`);
});
