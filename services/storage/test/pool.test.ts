import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createPool } from "../src/pool.js";

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
