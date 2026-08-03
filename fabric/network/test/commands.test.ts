import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { runCommand } from "../src/commands.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// Real child processes rather than a stub. Every network script goes through this one wrapper, and
// what it has to get right is how the shell reports failure: an exit code, a signal, or a binary
// that was never there. None of those can be reproduced by faking the spawn.
describe("running Fabric's shell tooling", () => {
  it("resolves when the command succeeds", async () => {
    await runCommand(process.execPath, ["-e", "process.exit(0)"], { cwd: packageRoot });
  });

  // A deploy that half worked and reported nothing is the failure mode this exists to prevent.
  it("rejects with the exit code when the command fails", async () => {
    await assert.rejects(
      runCommand(process.execPath, ["-e", "process.exit(3)"], { cwd: packageRoot }),
      (error: Error) => {
        assert.match(error.message, /exited with code 3/);
        return true;
      }
    );
  });

  // A killed process reports no exit code, so reading one would give "exited with code null" and
  // say nothing about what actually happened.
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

  // Fabric's tooling is shell based, and the usual reason it is not there is that the binaries were
  // never installed. That has to surface rather than hang or resolve.
  it("rejects when the command does not exist at all", async () => {
    await assert.rejects(
      runCommand(join(packageRoot, "no-such-binary"), [], { cwd: packageRoot }),
      (error: Error) => {
        assert.match(error.message, /ENOENT/);
        return true;
      }
    );
  });

  // The network scripts are invoked as ./network.sh from the network directory, so a wrapper that
  // ignored the working directory would run the wrong thing or nothing at all.
  it("runs the command in the directory it was given", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cwd-"));
    // Exits zero only if the child really started where it was told to.
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

// Run in a child process, because this ends the process it is called in. Every network script's
// catch block goes through it, so a change that stopped it setting a failing exit code would leave
// a failed deploy looking successful to anything scripting these commands.
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

    // Non-zero so a failed deploy is not reported as a success to anything scripting it, and
    // prefixed so the reason is picked out of Fabric's own output.
    assert.equal(result.status, 1);
    assert.match(result.stderr, /\[fabric-network\] the peer refused the definition/);
  });

  // Fabric's tooling and the odd library throw strings and objects, and those still have to name
  // something rather than printing "[object Object]" with no reason at all.
  it("reports something thrown that was never an Error", () => {
    const result = report(`"network.sh is not executable"`);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /\[fabric-network\] network\.sh is not executable/);
  });
});
