/**
 * Demo-only helper that lets the browser console play both the sensor and a dishonest oracle.
 *
 * Everything here exists so an operator can attack the system live and watch it get caught. It is
 * deliberately outside every production package: it holds the demo sensor's private key, it writes
 * to the oracle's database behind the oracle's back, and it will submit evidence it knows to be
 * false. None of that belongs in a service that ships.
 *
 *   POST /demo/run     sign readings, store them, anchor the fingerprint
 *   POST /demo/tamper  edit a stored reading directly in PostgreSQL, around the application
 *
 * Run it beside the six backends: pnpm demo:server (port 3016).
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

// The sensor's own package, which is the only place its private key lives.
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const keyDirectory = process.env.SENSOR_KEY_DIR ?? join(packageRoot, "..", "sensor", "data");

const pool = createPool({ connectionString: process.env.DATABASE_URL ?? ORACLE_DATABASE_URL });
const repository = createTemperatureRepository(pool);

/**
 * How the oracle behaves on this run.
 *
 * `honest` is the real pipeline. The other two are the two ways an oracle can lie before the
 * fingerprint is ever computed, and each is caught by a different check.
 */
type RunMode = "honest" | "fabricate" | "fake-summary";

interface RunRequest {
  readonly batchId: string;
  readonly readings: readonly { recordedAt: string; celsius: number }[];
  readonly mode?: RunMode;
  // fabricate: the value written to the database in place of the one the sensor signed.
  readonly fabricate?: { sequence: number; celsius: number };
  // fake-summary: what the oracle tells the contract, regardless of what it stored.
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
 * Signs each reading as the sensor would, at the moment it measured it.
 *
 * The timestamp is completed here rather than in the browser because the page only asks for a time
 * of day. Signing happens before any tampering, which is the point: the sensor's word is fixed
 * before the oracle gets a chance to change its mind.
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
 * The check an honest oracle runs on itself before committing to anything.
 *
 * It proves nothing to anyone else, since the oracle runs it and could remove it — which is exactly
 * what `mode` does here. Its real job is to fail fast on a feed that was altered on the way in.
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

async function handleRun(body: RunRequest): Promise<unknown> {
  const batchId = String(body.batchId ?? "").trim();
  if (!batchId) {
    throw new Error("'batchId' is required.");
  }
  if (!Array.isArray(body.readings) || body.readings.length === 0) {
    throw new Error("'readings' must contain at least one reading.");
  }

  const mode: RunMode = body.mode ?? "honest";
  const signed = await signAsSensor(batchId, body.readings);

  // The fabrication happens after signing and before storing, which is the only window an oracle
  // actually has. The signature it stores alongside still covers the value the sensor measured.
  const fabricated = mode === "fabricate" ? body.fabricate : undefined;
  const stored = fabricated
    ? signed.map((reading) =>
        reading.sequence === fabricated.sequence
          ? { ...reading, celsius: Number(fabricated.celsius) }
          : reading
      )
    : signed;

  if (mode === "honest") {
    await verifyAsOracle(batchId, stored);
  }

  const honestStatistics = calculateTemperatureStatistics(stored);
  const evidenceHash = sha256TemperatureReadings(batchId, stored);
  const evidenceId = `EV-${batchId}-${evidenceHash.slice(0, 8)}`;

  // What the contract is told. In fake-summary mode this no longer describes the stored readings,
  // which is invisible on chain and obvious to anyone who recomputes it.
  const reported: TemperatureStatistics =
    mode === "fake-summary" && body.fakeStatistics
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
    mode,
    evidenceHash,
    readingCount: honestStatistics.readingCount,
    reportedStatistics: reported,
    actualStatistics: honestStatistics,
    complianceOutcome: record.complianceOutcome ?? null,
    fabricTransactionId: record.submittedTxId ?? null
  };
}

// The oracle's own read of the range the contract will apply. The contract decides for itself.
function isSafe(statistics: TemperatureStatistics): boolean {
  return statistics.minCelsius >= 0 && statistics.maxCelsius <= 5;
}

/**
 * Changes one stored reading with straight SQL, going around the application entirely.
 *
 * This is the attacker who already has the database, and it is the case the fingerprint on the
 * ledger exists for: whatever this writes, it cannot reach back and change what was committed.
 */
async function handleTamper(body: { evidenceId?: unknown; celsius?: unknown }): Promise<unknown> {
  const evidenceId = String(body.evidenceId ?? "").trim();
  if (!evidenceId) {
    throw new Error("'evidenceId' is required.");
  }

  // A comfortable value inside the safe range. Replacing rather than nudging, so the edit always
  // reads as someone hiding a breach instead of producing an arithmetic curiosity like -2.9.
  const celsius = Number(body.celsius ?? 3.2);
  if (!Number.isFinite(celsius)) {
    throw new Error("'celsius' must be a number.");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // The warmest reading, because that is the one worth hiding.
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
    return { evidenceId, changed: result.rows[0] };
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
    // Open, because the page is served from whichever of the six backends you happened to open.
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
