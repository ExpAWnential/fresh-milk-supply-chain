/**
 * `pnpm fabric:stop`. Tears the network down, ledger included.
 */
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { reportFailure, runCommand } from "./commands.js";
import { assertNetworkAvailable, backendPath, networkPath } from "./config.js";

// The event listener's checkpoint records a block number, and the next network starts numbering
// from zero again. Left in place it would make the regulator resume from a block the new chain has
// not reached, so every compliance event of the next run is skipped and the verdict archive stays
// empty with nothing reporting an error.
async function removeEventCheckpoints(): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(backendPath);
  } catch {
    // No backend directory to clean. Nothing to do, and not worth failing the teardown over.
    return;
  }

  const checkpoints = entries.filter((entry) => entry.endsWith(".checkpoint"));
  await Promise.all(checkpoints.map((entry) => rm(join(backendPath, entry), { force: true })));

  if (checkpoints.length > 0) {
    console.log(
      `[fabric-network] removed ${checkpoints.length} ledger event checkpoint(s); the next ` +
        `network starts from block zero.`
    );
  }
}

try {
  assertNetworkAvailable();

  console.warn(
    "[fabric-network] stopping the network removes the ledger, the channel artifacts and the " +
      "committed chaincode. Everything has to be deployed again afterwards."
  );

  await runCommand("./network.sh", ["down"], { cwd: networkPath });
  await removeEventCheckpoints();
  console.log("[fabric-network] network stopped.");
} catch (error) {
  reportFailure(error);
}
