import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { createPool, ORACLE_DATABASE_URL, REGULATOR_DATABASE_URL } from "../src/pool.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("connection pool", () => {
  it("refuses an empty connection string rather than failing later at query time", () => {
    assert.throws(() => createPool({ connectionString: "   " }), /must not be empty/);
    assert.throws(() => createPool({ connectionString: "" }), /must not be empty/);
  });

  it("applies the configured limits", async () => {
    const pool = createPool({
      connectionString: "postgres://user:pass@localhost:5432/db",
      maxConnections: 3,
      idleTimeoutMilliseconds: 1_000,
      connectionTimeoutMilliseconds: 250
    });

    try {
      assert.equal(pool.options.max, 3);
      assert.equal(pool.options.idleTimeoutMillis, 1_000);
      assert.equal(pool.options.connectionTimeoutMillis, 250);
    } finally {
      await pool.end();
    }
  });

  it("falls back to defaults when limits are not given", async () => {
    const pool = createPool({ connectionString: "postgres://user:pass@localhost:5432/db" });
    try {
      assert.equal(pool.options.max, 10);
      assert.equal(pool.options.idleTimeoutMillis, 30_000);
      assert.equal(pool.options.connectionTimeoutMillis, 5_000);
    } finally {
      await pool.end();
    }
  });
});

// Two companies keep off-chain data and they keep different things. Sharing a database, or a login
// into one, would let the oracle read the regulator's record of the verdicts on its own evidence.
describe("the two databases this package creates", () => {
  it("gives the oracle and the regulator separate databases", () => {
    assert.notEqual(ORACLE_DATABASE_URL, REGULATOR_DATABASE_URL);
    assert.match(ORACLE_DATABASE_URL, /\/freshmilk_oracle$/);
    assert.match(REGULATOR_DATABASE_URL, /\/freshmilk_regulator$/);
  });

  it("gives each of them its own login", () => {
    assert.match(ORACLE_DATABASE_URL, /^postgres:\/\/oracle_app:/);
    assert.match(REGULATOR_DATABASE_URL, /^postgres:\/\/regulator_app:/);
  });

  it("defaults to the standard port", () => {
    assert.match(ORACLE_DATABASE_URL, /@localhost:5432\//);
    assert.match(REGULATOR_DATABASE_URL, /@localhost:5432\//);
  });

  // The compose file publishes on POSTGRES_PORT for anyone whose 5432 is already taken. Hardcoding
  // the port here would leave that override with nothing reading it. The URLs are built once, when
  // the module loads, so the override only takes effect in a process started with it set, and this
  // runs as one for that reason.
  it("follows POSTGRES_PORT, which is what the compose file publishes on", () => {
    const child = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "-e",
        `const pool = await import("./src/pool.ts");
         console.log(pool.ORACLE_DATABASE_URL, pool.REGULATOR_DATABASE_URL);`
      ],
      {
        cwd: packageRoot,
        encoding: "utf8",
        env: { ...process.env, POSTGRES_PORT: "6543" }
      }
    );

    assert.match(child.stdout, /@localhost:6543\/freshmilk_oracle/);
    assert.match(child.stdout, /@localhost:6543\/freshmilk_regulator/);
  });
});
