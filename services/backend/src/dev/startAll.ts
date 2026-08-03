/**
 * Starts one backend per company for local development, and stops them all together.
 *
 * Each child is an ordinary `src/index.ts` with a different ORGANISATION, so what runs here is
 * exactly what would run if the six were deployed to six machines. Nothing about the six-process
 * arrangement lives in the backend itself.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ORACLE_DATABASE_URL, REGULATOR_DATABASE_URL } from "@fresh-milk/storage";
import { ORGANISATIONS, originOf, type OffChainStore, type Organisation } from "../organisations.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const entryPoint = join(packageRoot, "src", "index.ts");

// Keyed by what a company stores rather than by its name, so which companies get a database is
// decided once, in the organisations table, rather than restated here.
const DATABASE_URLS: Record<OffChainStore, string> = {
  readings: ORACLE_DATABASE_URL,
  verdicts: REGULATOR_DATABASE_URL
};

function environmentFor(organisation: Organisation): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ORGANISATION: organisation.name };

  // Deleted rather than left unset. A DATABASE_URL in the shell would otherwise hand the farm a
  // database it has no business holding.
  delete env.DATABASE_URL;
  if (organisation.offChainStore) {
    env.DATABASE_URL = DATABASE_URLS[organisation.offChainStore];
  }

  // Named per company so a second listener could never quietly share the regulator's place in the
  // chain. Only the regulator writes one today.
  env.EVENT_CHECKPOINT_PATH = `.fabric-events.${organisation.name}.checkpoint`;

  return env;
}

// Six interleaved logs are unreadable without knowing which process produced each line.
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
// Until every company is listening, one dying means a misconfiguration and a half-started demo is
// worth nothing. Afterwards it means a company went down, which is a thing this architecture is
// supposed to survive and worth being able to demonstrate.
let allListening = false;

async function startAll(): Promise<void> {
  for (const organisation of ORGANISATIONS) {
    const label = `${organisation.name}:${organisation.backendPort}`;
    // node --import tsx rather than the tsx binary, so this does not depend on what is on PATH.
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
        // A port already in use, a missing wallet, an unreadable certificate. Five surviving
        // processes would hide which one failed and leave a demo that half works.
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

// Polled rather than assumed. Announcing six backends the moment they are spawned claimed
// something that was not true yet, and the first thing the README tells you to do is open one of
// these ports.
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

    // A closed port refuses in microseconds, so without this the loop would spin flat out for as
    // long as the slowest company takes to bind.
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
  // A second Ctrl-C while the first is still working would restart this whole sequence.
  if (stopping) {
    return;
  }
  stopping = true;

  for (const [child] of children) {
    child.kill("SIGTERM");
  }

  // Ctrl-C already reaches the whole process group, but a child started any other way would not
  // get it, so the signal above is sent explicitly and anything still alive is killed outright.
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
