import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { runCommand } from "../src/commands.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// Real child processes cover exit codes, signals and missing executables.
describe("running Fabric's shell tooling", () => {
  it("resolves when the command succeeds", async () => {
    await runCommand(process.execPath, ["-e", "process.exit(0)"], { cwd: packageRoot });
  });

  it("rejects with the exit code when the command fails", async () => {
    await assert.rejects(
      runCommand(process.execPath, ["-e", "process.exit(3)"], { cwd: packageRoot }),
      (error: Error) => {
        assert.match(error.message, /exited with code 3/);
        return true;
      }
    );
  });

  // Signal termination has no exit code and needs its own diagnostic.
  it("names the signal when the command was killed rather than reporting no code", async () => {
    await assert.rejects(
      runCommand(process.execPath, ["-e", "process.kill(process.pid, 'SIGTERM')"], {
        cwd: packageRoot
      }),
      (error: Error) => {
        assert.match(error.message, /terminated by SIGTERM/);
        return true;
      }
    );
  });

  it("rejects when the command does not exist at all", async () => {
    await assert.rejects(
      runCommand(join(packageRoot, "no-such-binary"), [], { cwd: packageRoot }),
      (error: Error) => {
        assert.match(error.message, /ENOENT/);
        return true;
      }
    );
  });

  it("runs the command in the directory it was given", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cwd-"));
    const reportsItsDirectory = `process.exit(process.cwd() === ${JSON.stringify(
      await realpath(directory)
    )} ? 0 : 1)`;

    await runCommand(process.execPath, ["-e", reportsItsDirectory], { cwd: directory });

    await assert.rejects(
      runCommand(process.execPath, ["-e", reportsItsDirectory], { cwd: packageRoot }),
      /exited with code 1/
    );
  });
});

// Test reportFailure in a child because it sets process exit state.
describe("reporting a failure", () => {
  const report = (expression: string) =>
    spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "-e",
        `const { reportFailure } = await import("./src/commands.ts"); reportFailure(${expression});`
      ],
      { cwd: packageRoot, encoding: "utf8" }
    );

  it("exits non-zero and prints the reason, prefixed so it is attributable", () => {
    const result = report(`new Error("the peer refused the definition")`);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /\[fabric-network\] the peer refused the definition/);
  });

  it("reports something thrown that was never an Error", () => {
    const result = report(`"network.sh is not executable"`);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /\[fabric-network\] network\.sh is not executable/);
  });
});
