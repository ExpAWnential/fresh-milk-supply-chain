import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { config } from "../dist/config.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// Run environment overrides in child processes because config is evaluated at module load time.
function configWith(env) {
  const child = spawnSync(
    process.execPath,
    ["-e", `import("./dist/config.js").then((m) => console.log(JSON.stringify(m.config)));`],
    { cwd: packageRoot, encoding: "utf8", env: { ...process.env, ...env } }
  );

  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
}

// Contract and chaincode names must match the fixed names used during deployment.
test("the chaincode names are fixed rather than configurable", () => {
  const fresh = configWith({
    STAKEHOLDER_CHAINCODE_NAME: "something-else",
    SUPPLYCHAIN_CHAINCODE_NAME: "something-else"
  });

  assert.equal(fresh.stakeholderChaincodeName, "stakeholder");
  assert.equal(fresh.supplychainChaincodeName, "supplychain");
});

test("the channel defaults to the one the network creates", () => {
  assert.equal(configWith({ FABRIC_CHANNEL_NAME: undefined }).fabricChannelName, "milkchannel");
});

test("the channel follows FABRIC_CHANNEL_NAME where it is set", () => {
  assert.equal(
    configWith({ FABRIC_CHANNEL_NAME: "othernetwork" }).fabricChannelName,
    "othernetwork"
  );
});

// Most organisations intentionally have no off-chain database.
test("no connection string means no database, not an empty one", () => {
  assert.equal(configWith({ DATABASE_URL: undefined }).databaseUrl, undefined);
});

test("a blank connection string reads as no database rather than as an empty one", () => {
  for (const blank of ["", "   ", "\t\n"]) {
    assert.equal(configWith({ DATABASE_URL: blank }).databaseUrl, undefined, JSON.stringify(blank));
  }
});

test("a connection string is trimmed, so a trailing newline does not reach the driver", () => {
  const fresh = configWith({ DATABASE_URL: "  postgres://user:pass@localhost:5432/db\n" });

  assert.equal(fresh.databaseUrl, "postgres://user:pass@localhost:5432/db");
});

test("the event checkpoint path defaults, and follows its variable where set", () => {
  assert.equal(
    configWith({ EVENT_CHECKPOINT_PATH: undefined }).eventCheckpointPath,
    ".fabric-events.checkpoint"
  );
  assert.equal(
    configWith({ EVENT_CHECKPOINT_PATH: ".fabric-events.regulator.checkpoint" })
      .eventCheckpointPath,
    ".fabric-events.regulator.checkpoint"
  );
});

test("the wallet path defaults into this repository, absolutely", () => {
  const fresh = configWith({ FABRIC_ORGANIZATIONS_PATH: undefined });

  assert.ok(fresh.fabricOrganizationsPath.startsWith("/"));
  assert.match(
    fresh.fabricOrganizationsPath,
    /fabric\/milk-network\/organizations\/peerOrganizations$/
  );
});

test("the wallet path follows FABRIC_ORGANIZATIONS_PATH where it is set", () => {
  assert.equal(
    configWith({ FABRIC_ORGANIZATIONS_PATH: "/somewhere/else" }).fabricOrganizationsPath,
    "/somewhere/else"
  );
});

// The module the rest of the backend imports, rather than a copy loaded for a test.
test("the shared config is the one every other module reads", () => {
  assert.equal(config.stakeholderChaincodeName, "stakeholder");
  assert.equal(config.supplychainChaincodeName, "supplychain");
  assert.equal(config.fabricChannelName, "milkchannel");
});
