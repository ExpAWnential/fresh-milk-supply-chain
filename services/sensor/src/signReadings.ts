/**
 * Stands in for a cold-chain temperature logger: generates its Ed25519 keys and signs CSV readings.
 *
 * It is a separate package because the private key must never be reachable by the oracle. The oracle
 * receives a signed file it did not produce, and has no code that could sign a changed measurement.
 * Only the public key leaves here, and only the regulator can register it on Fabric.
 */
import { generateKeyPairSync } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SIGNED_READING_COLUMNS, signReading, type SignableReading } from "@fresh-milk/storage";

// Both src and dist sit one level below the sensor package root.
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const keyDirectory = join(packageRoot, "data");

// The shared column list, so signed output stays valid input to the oracle's reader.
const SIGNED_HEADER = SIGNED_READING_COLUMNS.join(",");

// These IDs must match the sensor keys registered through the browser client.
const DEMO_SENSORS = ["SENSOR-001", "SENSOR-002"];

function keyPaths(sensorId: string): { privatePath: string; publicPath: string } {
  return {
    privatePath: join(keyDirectory, `${sensorId}.key`),
    publicPath: join(keyDirectory, `${sensorId}.pub`)
  };
}

async function keygen(sensorIds: readonly string[]): Promise<void> {
  await mkdir(keyDirectory, { recursive: true });

  for (const sensorId of sensorIds) {
    const pair = generateKeyPairSync("ed25519");
    const { privatePath, publicPath } = keyPaths(sensorId);

    await writeFile(
      privatePath,
      `${pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64")}\n`
    );
    await writeFile(
      publicPath,
      `${pair.publicKey.export({ format: "der", type: "spki" }).toString("base64")}\n`
    );
    console.log(`[sensor] wrote ${privatePath} and ${publicPath}`);
  }

  // The control panel keeps its own copy of these public keys.
  console.log(
    "\n[sensor] Re-sign the readings, then copy the new public keys into SENSORS in\n" +
      "         services/backend/public/index.html, or the demo will register the old ones."
  );
}

// Refuse already-signed input instead of accidentally signing its signature columns.
function parseUnsignedCsv(csv: string): readonly Record<string, string>[] {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) {
    throw new Error("The CSV must have a header and at least one reading.");
  }

  const headers = lines[0].split(",").map((header) => header.trim());
  if (headers.includes("signature")) {
    throw new Error(
      "That CSV is already signed. Sign the unsigned original, or the signature would cover a " +
        "signature."
    );
  }

  return lines.slice(1).map((line, index) => {
    const values = line.split(",").map((value) => value.trim());
    if (values.length !== headers.length) {
      throw new Error(
        `Row ${index + 2} has ${values.length} values but expected ${headers.length}.`
      );
    }
    return Object.fromEntries(headers.map((header, column) => [header, values[column]]));
  });
}

async function readKey(sensorId: string): Promise<string> {
  const { privatePath } = keyPaths(sensorId);
  try {
    return (await readFile(privatePath, "utf8")).trim();
  } catch {
    throw new Error(`No private key for '${sensorId}'. Run 'pnpm sensor:keygen' first.`);
  }
}

async function signCsv(inputPath: string): Promise<void> {
  const rows = parseUnsignedCsv(await readFile(inputPath, "utf8"));
  const keys = new Map<string, string>();

  const signed: string[] = [];
  // Sign the one-based file position so later deletion creates a detectable gap.
  for (const [index, row] of rows.entries()) {
    const celsius = Number(row.celsius);
    if (!Number.isFinite(celsius)) {
      throw new Error(`Row ${index + 2} has an invalid celsius value: ${row.celsius}`);
    }

    const reading: SignableReading = {
      batchId: row.batchId,
      sensorId: row.sensorId,
      sequence: index + 1,
      recordedAt: row.recordedAt,
      celsius
    };

    let privateKey = keys.get(reading.sensorId);
    if (!privateKey) {
      privateKey = await readKey(reading.sensorId);
      keys.set(reading.sensorId, privateKey);
    }

    signed.push(
      [
        reading.batchId,
        reading.sensorId,
        reading.sequence,
        reading.recordedAt,
        row.celsius,
        signReading(reading, privateKey)
      ].join(",")
    );
  }

  await writeFile(inputPath, `${[SIGNED_HEADER, ...signed].join("\n")}\n`);
  console.log(`[sensor] signed ${signed.length} readings in ${inputPath}`);
}

const [command, argument] = process.argv.slice(2);

try {
  if (command === "keygen") {
    await keygen(argument ? [argument] : DEMO_SENSORS);
  } else if (command === "sign") {
    if (!argument) {
      throw new Error("Usage: pnpm sensor:sign <path-to-csv>");
    }
    await signCsv(argument);
  } else {
    throw new Error("Usage: pnpm sensor:keygen | pnpm sensor:sign <path-to-csv>");
  }
} catch (error) {
  console.error(`[sensor] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
