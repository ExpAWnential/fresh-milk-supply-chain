/**
 * Where Fabric's test network lives and what this project deploys onto it. One place for the
 * paths, channel and chaincode list that all four network scripts share.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface ChaincodeDefinition {
  readonly name: string;
  readonly packageName: string;
  readonly sourcePath: string;
}

// Resolves the same way from src/ under tsx and from dist/ after a build, since both sit one
// level below the package root and two below fabric/.
const networkPackageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fabricDirectory = resolve(networkPackageDirectory, "..");

// Chaincode is packaged from a staging copy rather than straight from the workspace. Fabric's
// packaging step runs npm against the source directory, and npm resolves pnpm's symlinked
// node_modules into a lockfile of link: entries that do not exist inside the peer's build
// container. Staging a clean copy keeps the two package managers out of each other's way.
export const buildDirectory = join(networkPackageDirectory, "build");

// The PoC builds on Fabric's test-network instead of a hand-rolled topology. It already provides
// the two organisations the design calls for, with Org1 acting as the regulator.
export const testNetworkPath =
  process.env.FABRIC_TEST_NETWORK_PATH ?? join(homedir(), "fabric-samples", "test-network");

export const channelName = process.env.FABRIC_CHANNEL_NAME ?? "milkchannel";

// CouchDB rather than LevelDB, because the traceability lookups need rich queries.
export const stateDatabase = "couchdb";

// Order matters on deployment: the supply-chain contracts delegate authorisation to the
// stakeholder registry, so the registry has to be committed first.
export const chaincodes: readonly ChaincodeDefinition[] = [
  {
    name: "stakeholder",
    packageName: "@fresh-milk/chaincode-stakeholder",
    sourcePath: join(fabricDirectory, "chaincode", "stakeholder")
  },
  {
    name: "supplychain",
    packageName: "@fresh-milk/chaincode-supplychain",
    sourcePath: join(fabricDirectory, "chaincode", "supplychain")
  }
];

export function assertTestNetworkAvailable(): void {
  if (existsSync(join(testNetworkPath, "network.sh"))) {
    return;
  }

  throw new Error(
    `Could not find Fabric's test-network at ${testNetworkPath}. Install it using the command ` +
      `in docs/setup.md, or set FABRIC_TEST_NETWORK_PATH to where it lives.`
  );
}
