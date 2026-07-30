/**
 * Runs Fabric's shell tooling and reports failures. Every network script goes through here so they
 * all fail the same way.
 */
import { spawn } from "node:child_process";

interface CommandOptions {
  readonly cwd: string;
}

// Fabric's tooling is shell based, so these wrappers shell out and stream its output straight
// through rather than capturing it. Network setup is slow and the progress matters when it fails.
export async function runCommand(
  command: string,
  args: readonly string[],
  options: CommandOptions
): Promise<void> {
  console.log(`[fabric-network] ${command} ${args.join(" ")}`);

  await new Promise<void>((resolveCommand, rejectCommand) => {
    const child = spawn(command, [...args], { cwd: options.cwd, stdio: "inherit" });

    child.on("error", rejectCommand);
    child.on("close", (code, signal) => {
      if (signal) {
        rejectCommand(new Error(`${command} was terminated by ${signal}.`));
        return;
      }

      if (code !== 0) {
        rejectCommand(new Error(`${command} ${args.join(" ")} exited with code ${code}.`));
        return;
      }

      resolveCommand();
    });
  });
}

export function reportFailure(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[fabric-network] ${message}`);
  process.exit(1);
}
