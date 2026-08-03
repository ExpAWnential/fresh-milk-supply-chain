/**
 * `pnpm fabric:start`. Brings the peers and orderer up and creates the channel.
 */
import { reportFailure, runCommand } from "./commands.js";
import {
  assertNetworkAvailable,
  channelName,
  stateDatabase,
  networkPath
} from "./config.js";

try {
  assertNetworkAvailable();

  await runCommand(
    "./network.sh",
    ["up", "createChannel", "-c", channelName, "-s", stateDatabase],
    { cwd: networkPath }
  );

  console.log(
    `[fabric-network] channel '${channelName}' is up with the ${stateDatabase} state database.`
  );
  console.log("[fabric-network] next: pnpm fabric:deploy-chaincode");
} catch (error) {
  reportFailure(error);
}
