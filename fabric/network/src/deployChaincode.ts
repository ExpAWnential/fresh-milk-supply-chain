import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { reportFailure, runCommand } from "./commands.js";
import {
  assertTestNetworkAvailable,
  buildDirectory,
  chaincodes,
  channelName,
  testNetworkPath,
  type ChaincodeDefinition
} from "./config.js";

function readOption(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1]?.trim() : undefined;
}

// A committed definition can only be replaced by a higher sequence number, so redeploying after a
// code change needs --sequence bumped. Fabric rejects the deployment otherwise.
const version = readOption("--version") ?? "1.0";
const sequence = readOption("--sequence") ?? "1";
const requestedName = readOption("--chaincode");

// The staged package holds only the compiled output and the manifest. Leaving the lockfile out is
// deliberate: the peer's builder runs `npm ci` when it finds one and `npm install` when it does
// not, and only the latter resolves correctly from inside the container.
async function stageChaincode(chaincode: ChaincodeDefinition): Promise<string> {
  const stagingPath = join(buildDirectory, chaincode.name);

  await rm(stagingPath, { recursive: true, force: true });
  await mkdir(stagingPath, { recursive: true });
  await cp(join(chaincode.sourcePath, "package.json"), join(stagingPath, "package.json"));
  await cp(join(chaincode.sourcePath, "dist"), join(stagingPath, "dist"), { recursive: true });

  return stagingPath;
}

try {
  const selected = requestedName
    ? chaincodes.filter((chaincode) => chaincode.name === requestedName)
    : chaincodes;

  if (selected.length === 0) {
    throw new Error(
      `Unknown chaincode '${requestedName}'. Expected one of: ` +
        `${chaincodes.map((chaincode) => chaincode.name).join(", ")}.`
    );
  }

  assertTestNetworkAvailable();

  for (const chaincode of selected) {
    await runCommand("pnpm", ["--filter", chaincode.packageName, "build"], {
      cwd: chaincode.sourcePath
    });

    const stagingPath = await stageChaincode(chaincode);

    // Declared as javascript rather than typescript because the staged copy is already compiled,
    // which keeps Fabric's packaging script from running npm inside the workspace.
    await runCommand(
      "./network.sh",
      [
        "deployCC",
        "-c",
        channelName,
        "-ccn",
        chaincode.name,
        "-ccp",
        stagingPath,
        "-ccl",
        "javascript",
        "-ccv",
        version,
        "-ccs",
        sequence
      ],
      { cwd: testNetworkPath }
    );
  }

  console.log(
    `[fabric-network] committed on '${channelName}' at version ${version}, sequence ${sequence}: ` +
      `${selected.map((chaincode) => chaincode.name).join(", ")}.`
  );
} catch (error) {
  reportFailure(error);
}
