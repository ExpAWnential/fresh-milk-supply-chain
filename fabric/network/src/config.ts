/**
 * Where the network lives and what this project deploys onto it. One place for the paths, channel
 * and chaincode list that all the network scripts share.
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

// The regulator's own peer has to run the transaction and agree, on top of enough of the others to
// still make a majority of the whole network. Four organisations satisfy the channel default on
// their own, so without the regulator term the other five could record a cold-chain verdict
// between themselves and the regulator would never see it. Being able to name a single role like
// this is the reason each company has its own organisation.
//
// The threshold is computed rather than written down: a majority of N organisations is N/2 + 1, and
// one of those is always the regulator. Adding a company would otherwise leave a literal here that
// quietly stopped being a majority.
const othersRequired = Math.floor((OTHER_MSPS.length + 1) / 2);

// Deliberately free of spaces. The deploy script passes this through an unquoted shell expansion,
// so a space would split the policy across arguments and the peer would reject it with an error
// that says nothing about whitespace.
const regulatorMustEndorse =
  `AND('${REGULATOR_MSP}.peer',` +
  `OutOf(${othersRequired},${OTHER_MSPS.map((msp) => `'${msp}.peer'`).join(",")}))`;

// Resolves the same way from src/ under tsx and from dist/ after a build, since both sit one
// level below the package root and two below fabric/.
const networkPackageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fabricDirectory = resolve(networkPackageDirectory, "..");

// Chaincode is packaged from a staging copy rather than straight from the workspace. Fabric's
// packaging step runs npm against the source directory, and npm resolves pnpm's symlinked
// node_modules into a lockfile of link: entries that do not exist inside the peer's build
// container. Staging a clean copy keeps the two package managers out of each other's way.
export const buildDirectory = join(networkPackageDirectory, "build");

// The network is kept in the repository rather than used from fabric-samples, so its topology is
// version controlled and every teammate brings up the same one.
export const networkPath =
  process.env.FABRIC_NETWORK_PATH ?? join(fabricDirectory, "milk-network");

// Only the binaries and Fabric's default core.yaml still come from the sample distribution. The
// network scripts read this through FABRIC_SAMPLES_HOME, which they inherit from this process.
export const fabricSamplesPath =
  process.env.FABRIC_SAMPLES_HOME ?? join(homedir(), "fabric-samples");

// Where the backends write their ledger event checkpoints. Tearing the network down has to remove
// them, because they hold block numbers from a chain that is about to stop existing.
export const backendPath = resolve(fabricDirectory, "..", "services", "backend");

export const channelName = process.env.FABRIC_CHANNEL_NAME ?? "milkchannel";

// CouchDB rather than LevelDB, because the traceability lookups need rich queries.
export const stateDatabase = "couchdb";

// Order matters on deployment: the supply-chain contracts delegate authorisation to the
// stakeholder registry, so the registry has to be committed first.
export const chaincodes: readonly ChaincodeDefinition[] = [
  {
    name: "stakeholder",
    packageName: "@fresh-milk/chaincode-stakeholder",
    sourcePath: join(fabricDirectory, "chaincode", "stakeholder"),
    // Every write here is a regulator-only attestation: who holds which role, and which public key
    // belongs to which sensor. The contract checks the submitter's certificate, but without this
    // the regulator's own peer need not have run the transaction and agreed, so the ledger would
    // record an attestation the attesting party never executed.
    //
    // Reads are unaffected. A cross-chaincode read runs inside the calling transaction and is
    // covered by that chaincode's policy, which is why this costs nothing on the hot path.
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

  // Checked here rather than letting the peer CLI fail forty seconds into a deploy with an error
  // that names neither the missing file nor the directory it was looked for in.
  if (!existsSync(join(fabricSamplesPath, "bin", "peer"))) {
    throw new Error(
      `Could not find Fabric's binaries at ${fabricSamplesPath}. Install them using the command ` +
        `in docs/setup.md, or set FABRIC_SAMPLES_HOME to where fabric-samples lives.`
    );
  }
}
