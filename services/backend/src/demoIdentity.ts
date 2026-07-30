import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Request } from "express";
import { config } from "./config.js";

export const DEMO_IDENTITY_HEADER = "x-demo-identity";

export interface DemoIdentity {
  readonly name: string;
  readonly mspId: string;
  readonly userPath: string;
  readonly peerEndpoint: string;
  readonly peerHostAlias: string;
  readonly peerTlsCaPath: string;
}

interface OrganisationProfile {
  readonly domain: string;
  readonly mspId: string;
  readonly peerEndpoint: string;
}

// Matches the two organisations the network script brings up. Org1 is the regulator side, which
// is also the only MSP the stakeholder registry accepts for first-time setup.
const ORGANISATIONS: Record<"org1" | "org2", OrganisationProfile> = {
  org1: {
    domain: "org1.example.com",
    mspId: "Org1MSP",
    peerEndpoint: "localhost:7051"
  },
  org2: {
    domain: "org2.example.com",
    mspId: "Org2MSP",
    peerEndpoint: "localhost:9051"
  }
};

// The demo maps a stakeholder name onto one of the enrolled network identities. The network
// currently enrols two users per organisation, so a name is reused if more stakeholders are
// needed than there are identities.
const DEMO_IDENTITIES: Record<string, { org: "org1" | "org2"; user: string }> = {
  regulator: { org: "org1", user: "Admin" },
  oracle: { org: "org1", user: "User1" },
  retailer: { org: "org2", user: "Admin" },
  logistics: { org: "org2", user: "User1" }
};

export function listDemoIdentities(): readonly string[] {
  return Object.keys(DEMO_IDENTITIES);
}

export function getDemoIdentity(name: string): DemoIdentity {
  const normalised = name.trim().toLowerCase();
  const mapping = DEMO_IDENTITIES[normalised];
  if (!mapping) {
    throw new Error(
      `Unknown demo identity '${name}'. Expected one of: ${listDemoIdentities().join(", ")}.`
    );
  }

  const organisation = ORGANISATIONS[mapping.org];
  const organisationPath = join(config.fabricOrganizationsPath, organisation.domain);

  return {
    name: normalised,
    mspId: organisation.mspId,
    userPath: join(organisationPath, "users", `${mapping.user}@${organisation.domain}`, "msp"),
    peerEndpoint: organisation.peerEndpoint,
    peerHostAlias: `peer0.${organisation.domain}`,
    peerTlsCaPath: join(organisationPath, "tlsca", `tlsca.${organisation.domain}-cert.pem`)
  };
}

// PoC only. The demo selects which enrolled Fabric wallet identity signs the transaction by
// sending a header. A real deployment would authenticate the caller and derive the identity
// from that, never from a client-supplied value.
export function resolveDemoIdentity(request: Request): DemoIdentity {
  const header = request.header(DEMO_IDENTITY_HEADER);
  if (!header) {
    throw new Error(
      `Missing ${DEMO_IDENTITY_HEADER} header. Expected one of: ${listDemoIdentities().join(", ")}.`
    );
  }

  return getDemoIdentity(header);
}

// Fabric names the certificate and key files unpredictably, so the single file in each directory
// is used rather than a hardcoded filename.
export async function readSingleFile(directory: string): Promise<string> {
  const entries = (await readdir(directory)).filter((entry) => !entry.startsWith("."));
  if (entries.length !== 1) {
    throw new Error(`Expected exactly one file in ${directory}, found ${entries.length}.`);
  }

  return join(directory, entries[0]);
}
