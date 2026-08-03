/**
 * Centralises the paths, topology and endorsement settings used to manage the Fabric network.
 *
 * The TypeScript wrappers and shell scripts consume the same values so chaincode order, channel
 * policy and local file locations cannot drift between separate commands.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface ChaincodeDefinition {
  readonly name: string;
  readonly packageName: string;
  readonly sourcePath: string;
  // Omitted to fall back on the channel's own policy, which is a majority of organisations.
  readonly endorsementPolicy?: string;
}

const REGULATOR_MSP = "RegulatorMSP";
const OTHER_MSPS = ["FarmMSP", "ProcessorMSP", "LogisticsMSP", "RetailerMSP", "OracleMSP"];

// Require the regulator plus enough other organisations to form a network majority. Compute the
// threshold so adding an organisation cannot silently weaken the policy.
const othersRequired = Math.floor((OTHER_MSPS.length + 1) / 2);

// Keep the policy free of spaces because the deployment shell expands it as one argument.
const regulatorMustEndorse =
  `AND('${REGULATOR_MSP}.peer',` +
  `OutOf(${othersRequired},${OTHER_MSPS.map((msp) => `'${msp}.peer'`).join(",")}))`;

// Both src and dist sit one level below the network package root.
const networkPackageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fabricDirectory = resolve(networkPackageDirectory, "..");

// Stage compiled chaincode separately so Fabric's npm build does not consume pnpm workspace links.
export const buildDirectory = join(networkPackageDirectory, "build");

// The version-controlled network definition keeps local topology consistent.
export const networkPath =
  process.env.FABRIC_NETWORK_PATH ?? join(fabricDirectory, "milk-network");

// Fabric binaries and core.yaml still come from the local fabric-samples installation.
export const fabricSamplesPath =
  process.env.FABRIC_SAMPLES_HOME ?? join(homedir(), "fabric-samples");

// Network teardown removes checkpoints whose block numbers belong to the discarded ledger.
export const backendPath = resolve(fabricDirectory, "..", "services", "backend");

export const channelName = process.env.FABRIC_CHANNEL_NAME ?? "milkchannel";

// Traceability lookups require CouchDB rich queries.
export const stateDatabase = "couchdb";

// Deploy the registry first because supply-chain authorisation calls it across chaincodes.
export const chaincodes: readonly ChaincodeDefinition[] = [
  {
    name: "stakeholder",
    packageName: "@fresh-milk/chaincode-stakeholder",
    sourcePath: join(fabricDirectory, "chaincode", "stakeholder"),
    // Registry writes are regulator attestations, so the regulator's peer must endorse them.
    endorsementPolicy: regulatorMustEndorse
  },
  {
    name: "supplychain",
    packageName: "@fresh-milk/chaincode-supplychain",
    sourcePath: join(fabricDirectory, "chaincode", "supplychain"),
    endorsementPolicy: regulatorMustEndorse
  }
];

export function assertNetworkAvailable(): void {
  if (!existsSync(join(networkPath, "network.sh"))) {
    throw new Error(
      `Could not find the network at ${networkPath}. It is part of this repository, so this ` +
        `usually means the working tree is incomplete.`
    );
  }

  // Fail before deployment work starts if the Fabric CLI is unavailable.
  if (!existsSync(join(fabricSamplesPath, "bin", "peer"))) {
    throw new Error(
      `Could not find Fabric's binaries at ${fabricSamplesPath}. Install them using the command ` +
        `in docs/setup.md, or set FABRIC_SAMPLES_HOME to where fabric-samples lives.`
    );
  }
}
