import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { config } from "../dist/config.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// Everything here is read from the environment once, when the module first loads, so an override
// only has an effect on a process started with it set. Each case runs as one for that reason.
function configWith(env) {
  const child = spawnSync(
    process.execPath,
    ["-e", `import("./dist/config.js").then((m) => console.log(JSON.stringify(m.config)));`],
    { cwd: packageRoot, encoding: "utf8", env: { ...process.env, ...env } }
  );

  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
}

// The deploy script commits the definitions under these names and the supply-chain chaincode names
// the registry when it calls across to it, so a variable here would only ever change one of the
// three and break the other two.
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
  assert.equal(configWith({ FABRIC_CHANNEL_NAME: "othernetwork" }).fabricChannelName, "othernetwork");
});

// Four of the six companies keep nothing off-chain, so no connection string is the correct
// configuration for most of the network rather than a mistake.
test("no connection string means no database, not an empty one", () => {
  assert.equal(configWith({ DATABASE_URL: undefined }).databaseUrl, undefined);
});

// A blank or whitespace-only value is what an unset variable in a shell script or compose file
// actually looks like. Passing it through would have the pool try to connect to nothing and fail at
// query time, rather than the routes answering 503 the way they do for a company with no database.
test("a blank connection string reads as no database rather than as an empty one", () => {
  for (const blank of ["", "   ", "\t\n"]) {
    assert.equal(configWith({ DATABASE_URL: blank }).databaseUrl, undefined, JSON.stringify(blank));
  }
});

test("a connection string is trimmed, so a trailing newline does not reach the driver", () => {
  const fresh = configWith({ DATABASE_URL: "  postgres://user:pass@localhost:5432/db\n" });

  assert.equal(fresh.databaseUrl, "postgres://user:pass@localhost:5432/db");
});

// Named per company by the dev launcher, so a second listener could never quietly share the
// regulator's place in the chain.
test("the event checkpoint path defaults, and follows its variable where set", () => {
  assert.equal(
    configWith({ EVENT_CHECKPOINT_PATH: undefined }).eventCheckpointPath,
    ".fabric-events.checkpoint"
  );
  assert.equal(
    configWith({ EVENT_CHECKPOINT_PATH: ".fabric-events.regulator.checkpoint" }).eventCheckpointPath,
    ".fabric-events.regulator.checkpoint"
  );
});

// The wallet material the network generates lives in this repository, so the default has to point
// at it and not at a path relative to wherever the process happened to be started from.
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
