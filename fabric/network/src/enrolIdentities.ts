/**
 * `pnpm fabric:enrol-identities`. Issues the extra user certificates the six demo roles need,
 * without disturbing the certificates already in use.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { reportFailure, runCommand } from "./commands.js";
import {
  buildDirectory,
  fabricSamplesPath,
  networkPath,
  assertNetworkAvailable
} from "./config.js";

// The registry models six roles but the test network is generated with two users per organisation,
// so two roles would otherwise share a certificate with another. cryptogen can extend a network
// that already exists: it issues only what is missing, signing with the organisation CA already on
// disk, so the users in use keep their certificates and everything registered against them stands.
const USERS_PER_ORGANISATION = 2;

const organisations = ["org1", "org2"] as const;

const organizationsPath = join(networkPath, "organizations");
const cryptogen = join(fabricSamplesPath, "bin", "cryptogen");

// Rewritten from the network's own template rather than kept as a copy here, so this cannot drift
// away from the configuration the rest of the network was generated from.
function withUserCount(template: string, count: number): string {
  const users = /(\n\s*Users:\s*\n\s*Count:\s*)(\d+)/;
  if (!users.test(template)) {
    throw new Error("Could not find the Users count in the network's cryptogen template.");
  }

  return template.replace(users, `$1${count}`);
}

async function usersOf(organisation: string): Promise<string[]> {
  const path = join(organizationsPath, "peerOrganizations", `${organisation}.example.com`, "users");
  return (await readdir(path)).sort();
}

async function main(): Promise<void> {
  assertNetworkAvailable();
  await mkdir(buildDirectory, { recursive: true });

  for (const organisation of organisations) {
    const templatePath = join(
      organizationsPath,
      "cryptogen",
      `crypto-config-${organisation}.yaml`
    );
    const staged = join(buildDirectory, `crypto-config-${organisation}.yaml`);
    await writeFile(
      staged,
      withUserCount(await readFile(templatePath, "utf8"), USERS_PER_ORGANISATION)
    );

    const before = await usersOf(organisation);
    await runCommand(cryptogen, ["extend", `--input=${organizationsPath}`, `--config=${staged}`], {
      cwd: networkPath
    });

    const after = await usersOf(organisation);
    const added = after.filter((user) => !before.includes(user));
    console.log(
      `[fabric-network] ${organisation}: ${after.length} users` +
        (added.length ? `, added ${added.join(", ")}` : ", nothing to add")
    );
  }
}

main().catch(reportFailure);
