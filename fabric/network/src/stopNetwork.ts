/**
 * `pnpm fabric:stop`. Tears the network down, ledger included.
 */
import { reportFailure, runCommand } from "./commands.js";
import { assertTestNetworkAvailable, testNetworkPath } from "./config.js";

try {
  assertTestNetworkAvailable();

  console.warn(
    "[fabric-network] stopping the network removes the ledger, the channel artifacts and the " +
      "committed chaincode. Everything has to be deployed again afterwards."
  );

  await runCommand("./network.sh", ["down"], { cwd: testNetworkPath });
  console.log("[fabric-network] network stopped.");
} catch (error) {
  reportFailure(error);
}
