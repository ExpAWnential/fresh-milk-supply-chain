import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import * as config from "../src/config.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// Environment overrides run in child processes because config is evaluated at module load time.
function inProcessWith(env: Record<string, string | undefined>, expression: string): string {
  const child = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "-e",
      `const config = await import("./src/config.ts");
       console.log(JSON.stringify(${expression}));`
    ],
    { cwd: packageRoot, encoding: "utf8", env: { ...process.env, ...env } }
  );

  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
}

// Report child-process checks as JSON so thrown errors remain inspectable.
function networkCheckWith(env: Record<string, string | undefined>): {
  ok: boolean;
  message: string;
} {
  return inProcessWith(
    env,
    `(() => {
       try {
         config.assertNetworkAvailable();
         return { ok: true, message: "" };
       } catch (error) {
         return { ok: false, message: error.message };
       }
     })()`
  ) as unknown as { ok: boolean; message: string };
}

// Minimal fixture containing the files checked by assertNetworkAvailable.
async function fakeInstallation({ networkScript = true, peerBinary = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), "fabric-"));
  const networkPath = join(root, "milk-network");
  const samplesPath = join(root, "fabric-samples");

  await mkdir(networkPath, { recursive: true });
  await mkdir(join(samplesPath, "bin"), { recursive: true });
  if (networkScript) {
    await writeFile(join(networkPath, "network.sh"), "#!/bin/sh\n");
  }
  if (peerBinary) {
    await writeFile(join(samplesPath, "bin", "peer"), "");
  }

  return { networkPath, samplesPath };
}

describe("what gets deployed", () => {
  // Cross-chaincode authorisation requires the registry to be deployed first.
  it("commits the stakeholder registry before the supply chain that reads it", () => {
    assert.deepEqual(
      config.chaincodes.map((chaincode) => chaincode.name),
      ["stakeholder", "supplychain"]
    );
  });

  it("names a package and a source directory for each", () => {
    for (const chaincode of config.chaincodes) {
      assert.match(chaincode.packageName, /^@fresh-milk\/chaincode-/);
      assert.match(chaincode.sourcePath, new RegExp(`chaincode/${chaincode.name}$`));
    }
  });
});

describe("the endorsement policy", () => {
  const supplychain = config.chaincodes.find((chaincode) => chaincode.name === "supplychain");
  const policy = supplychain?.endorsementPolicy ?? "";

  it("requires the regulator's own peer to have run and agreed", () => {
    assert.match(policy, /^AND\('RegulatorMSP\.peer',/);
  });

  // A six-organisation majority is the regulator plus three others.
  it("requires enough of the others to still make a majority of the network", () => {
    assert.match(policy, /OutOf\(3,/);

    const named = policy.match(/'([A-Za-z]+MSP)\.peer'/g) ?? [];
    assert.equal(named.length, 6, "every organisation should appear exactly once");
    assert.equal(new Set(named).size, 6);
  });

  it("names every company on the network", () => {
    for (const msp of [
      "RegulatorMSP",
      "FarmMSP",
      "ProcessorMSP",
      "LogisticsMSP",
      "RetailerMSP",
      "OracleMSP"
    ]) {
      assert.match(policy, new RegExp(`'${msp}\\.peer'`), `${msp} is not in the policy`);
    }
  });

  it("carries no whitespace, because it is expanded unquoted by the shell", () => {
    assert.doesNotMatch(policy, /\s/);
  });

  it("holds the registry to the same policy, because its writes are attestations too", () => {
    const stakeholder = config.chaincodes.find((chaincode) => chaincode.name === "stakeholder");
    assert.equal(stakeholder?.endorsementPolicy, policy);
  });
});

describe("where the network lives", () => {
  it("defaults to the copy kept in this repository", () => {
    assert.match(config.networkPath, /fabric\/milk-network$/);
  });

  it("uses CouchDB, which the traceability lookups need for rich queries", () => {
    assert.equal(config.stateDatabase, "couchdb");
  });

  it("defaults the channel to the one the backends read", () => {
    assert.equal(inProcessWith({ FABRIC_CHANNEL_NAME: undefined }, "config.channelName"), "milkchannel");
  });

  it("follows FABRIC_CHANNEL_NAME where it is set", () => {
    assert.equal(
      inProcessWith({ FABRIC_CHANNEL_NAME: "othernetwork" }, "config.channelName"),
      "othernetwork"
    );
  });

  it("knows where the backends write their event checkpoints", () => {
    assert.match(config.backendPath, /services\/backend$/);
  });
});

describe("checking the network can be reached before running anything", () => {
  it("passes when both the network and Fabric's binaries are there", async () => {
    const { networkPath, samplesPath } = await fakeInstallation();

    const checked = networkCheckWith({
      FABRIC_NETWORK_PATH: networkPath,
      FABRIC_SAMPLES_HOME: samplesPath
    });

    assert.equal(checked.ok, true, checked.message);
  });

  it("names the missing network, and that it should have been checked out", async () => {
    const { networkPath, samplesPath } = await fakeInstallation({ networkScript: false });

    const checked = networkCheckWith({
      FABRIC_NETWORK_PATH: networkPath,
      FABRIC_SAMPLES_HOME: samplesPath
    });

    assert.equal(checked.ok, false);
    assert.match(checked.message, /Could not find the network at/);
    assert.match(checked.message, new RegExp(networkPath));
    assert.match(checked.message, /working tree is incomplete/);
  });

  it("names the missing binaries and how to install them", async () => {
    const { networkPath, samplesPath } = await fakeInstallation({ peerBinary: false });

    const checked = networkCheckWith({
      FABRIC_NETWORK_PATH: networkPath,
      FABRIC_SAMPLES_HOME: samplesPath
    });

    assert.equal(checked.ok, false);
    assert.match(checked.message, /Could not find Fabric's binaries at/);
    assert.match(checked.message, new RegExp(samplesPath));
    assert.match(checked.message, /docs\/setup\.md|FABRIC_SAMPLES_HOME/);
  });

  it("defaults to fabric-samples in the home directory", () => {
    assert.match(
      inProcessWith({ FABRIC_SAMPLES_HOME: undefined }, "config.fabricSamplesPath"),
      /fabric-samples$/
    );
  });
});
