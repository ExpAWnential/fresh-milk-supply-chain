/**
 * `pnpm fabric:start`. Brings the peers and orderer up and creates the channel.
 */
import { reportFailure, runCommand } from "./commands.js";
import {
  assertTestNetworkAvailable,
  channelName,
  stateDatabase,
  testNetworkPath
} from "./config.js";

try {
  assertTestNetworkAvailable();

  // One invocation brings the peers and orderer up and creates the channel, which avoids the
  // network being left half configured if the second step is forgotten.
  await runCommand(
    "./network.sh",
    ["up", "createChannel", "-c", channelName, "-s", stateDatabase],
    { cwd: testNetworkPath }
  );

  console.log(
    `[fabric-network] channel '${channelName}' is up with the ${stateDatabase} state database.`
  );
  console.log("[fabric-network] next: pnpm fabric:deploy-chaincode");
} catch (error) {
  reportFailure(error);
}
