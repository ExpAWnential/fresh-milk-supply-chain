import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const entryPoint = join(packageRoot, "dist", "index.js");

// Run as a real process, because what is being checked is that these are refused before the port is
// bound. A backend that started and then answered everything with a fault would look like a running
// company to the demo page and to the other five.
function start(env) {
  return spawnSync(process.execPath, [entryPoint], {
    cwd: packageRoot,
    encoding: "utf8",
    // Point the wallet somewhere empty so a machine that has brought the network up gets the same
    // result as one that has not.
    env: {
      ...process.env,
      FABRIC_ORGANIZATIONS_PATH: join(packageRoot, "no-such-organizations"),
      DATABASE_URL: undefined,
      ...env
    }
  });
}

// Which company a process acts for decides which private key signs every transaction it makes, so
// it is the one thing it cannot be left to guess at.
test("a backend with no company named refuses to start, and lists the six", () => {
  const result = start({ ORGANISATION: undefined });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Set ORGANISATION/);
  for (const name of ["regulator", "farm", "processor", "logistics", "retailer", "oracle"]) {
    assert.match(result.stderr, new RegExp(name));
  }
});

test("a backend named for a company that is not on the network refuses to start", () => {
  const result = start({ ORGANISATION: "smuggler" });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown organisation 'smuggler'/);
});

// The oracle is declared as holding the readings, so no connection string is a misconfiguration
// rather than a company that stores nothing. Left to run it would fall through to the remote
// readings source, fetch its own readings from itself over HTTP, and answer 503 to its own request.
test("a company that is supposed to hold data refuses to start without a database", () => {
  const result = start({ ORGANISATION: "oracle" });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DATABASE_URL/);
  assert.match(result.stderr, /oracle/);
  // Says what to do about it, rather than only what is wrong.
  assert.match(result.stderr, /pnpm backend:dev/);
});

test("the regulator refuses to start without the database its archive lives in", () => {
  const result = start({ ORGANISATION: "regulator" });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DATABASE_URL/);
});

// The four companies that keep nothing off-chain are correct with no connection string, so this one
// has to get past the guard above and fail later, on the wallet it cannot read. A process whose
// wallet cannot be read could not sign a single transaction, so failing there is better than
// binding the port and refusing everything that arrives at it.
test("a company that keeps nothing off-chain fails on its wallet, not on a database", () => {
  const result = start({ ORGANISATION: "farm" });

  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stderr, /DATABASE_URL/);
  assert.match(result.stderr, /ENOENT|no such file/);
  assert.doesNotMatch(result.stdout, /listening/);
});
