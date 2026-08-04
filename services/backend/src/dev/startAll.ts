/** Coordinates the six local backends and shuts them down as one application. */
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ORACLE_DATABASE_URL, REGULATOR_DATABASE_URL } from "@fresh-milk/storage";
import {
  ORGANISATIONS,
  originOf,
  type OffChainStore,
  type Organisation
} from "../organisations.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const entryPoint = join(packageRoot, "src", "index.ts");

// Database URLs follow the off-chain store declared in the organisation table.
const DATABASE_URLS: Record<OffChainStore, string> = {
  readings: ORACLE_DATABASE_URL,
  verdicts: REGULATOR_DATABASE_URL
};

function environmentFor(organisation: Organisation): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ORGANISATION: organisation.name };

  // Remove an inherited URL for organisations that own no off-chain store.
  delete env.DATABASE_URL;
  if (organisation.offChainStore) {
    env.DATABASE_URL = DATABASE_URLS[organisation.offChainStore];
  }

  // Keep each organisation's event checkpoint distinct.
  env.EVENT_CHECKPOINT_PATH = `.fabric-events.${organisation.name}.checkpoint`;

  return env;
}

// Prefix interleaved child output with its organisation name.
function prefixOutput(child: ChildProcess, label: string): void {
  for (const stream of [child.stdout, child.stderr]) {
    if (!stream) {
      continue;
    }
    createInterface({ input: stream }).on("line", (line) => {
      console.log(`[${label}] ${line}`);
    });
  }
}

const children = new Map<ChildProcess, string>();
let stopping = false;
// A child exiting during startup aborts the incomplete application. Later exits leave the others running.
let allListening = false;

async function startAll(): Promise<void> {
  for (const organisation of ORGANISATIONS) {
    const label = `${organisation.name}:${organisation.backendPort}`;
    // Use Node's tsx import so child startup does not depend on PATH.
    const child = spawn(process.execPath, ["--import", "tsx", entryPoint], {
      cwd: packageRoot,
      env: environmentFor(organisation),
      stdio: ["ignore", "pipe", "pipe"]
    });

    children.set(child, label);
    prefixOutput(child, label);

    child.on("error", (error) => {
      console.error(`[${label}] could not be started: ${error.message}`);
      stopAll(1);
    });

    child.on("exit", (code, signal) => {
      children.delete(child);
      if (stopping) {
        return;
      }

      const how = signal ?? `code ${code}`;
      if (!allListening) {
        // Stop all children when any backend fails before startup completes.
        console.error(`[${label}] failed to start (${how}). Stopping the others.`);
        stopAll(1);
        return;
      }

      console.error(
        `[${label}] stopped (${how}). The other ${children.size} are still running, and that ` +
          `company's transactions will now fail while everyone else carries on.`
      );
    });
  }

  await waitUntilListening();
}

// Wait for every health endpoint before announcing that the consortium is ready.
async function waitUntilListening(): Promise<void> {
  const deadline = 60_000;
  const startedAt = process.hrtime.bigint();
  const pending = new Set(ORGANISATIONS);

  while (pending.size > 0) {
    if (stopping) {
      return;
    }
    if (Number(process.hrtime.bigint() - startedAt) / 1e6 > deadline) {
      console.error(
        `Gave up waiting for: ${[...pending].map((o) => o.name).join(", ")}. Stopping.`
      );
      stopAll(1);
      return;
    }

    await Promise.all(
      [...pending].map(async (organisation) => {
        try {
          const response = await fetch(`${originOf(organisation)}/identity`);
          if (response.ok) {
            await response.arrayBuffer();
            pending.delete(organisation);
          }
        } catch {
          // Not up yet. The deadline above is what gives up.
        }
      })
    );

    // Avoid a busy loop while ports are still closed.
    if (pending.size > 0) {
      await new Promise((wake) => setTimeout(wake, 200));
    }
  }

  allListening = true;
  console.log(
    `\nAll ${ORGANISATIONS.length} backends are listening:\n` +
      ORGANISATIONS.map((o) => `  ${o.name.padEnd(10)} ${originOf(o)}`).join("\n") +
      `\n\nPress Ctrl-C to stop them all.\n`
  );
}

function stopAll(exitCode: number): void {
  // Handle only the first shutdown signal.
  if (stopping) {
    return;
  }
  stopping = true;

  for (const [child] of children) {
    child.kill("SIGTERM");
  }

  // Explicitly terminate any child that did not receive the process-group signal.
  const deadline = setTimeout(() => {
    for (const [child, label] of children) {
      console.error(`[${label}] did not stop, killing it.`);
      child.kill("SIGKILL");
    }
    process.exit(exitCode);
  }, 5_000);

  const waitForChildren = setInterval(() => {
    if (children.size === 0) {
      clearTimeout(deadline);
      clearInterval(waitForChildren);
      process.exit(exitCode);
    }
  }, 100);
}

process.once("SIGINT", () => stopAll(0));
process.once("SIGTERM", () => stopAll(0));

startAll();
