/**
 * Maps a role name onto one of the certificates the network generated, so each stakeholder signs
 * as itself.
 *
 * This only chooses which key signs. It grants no permission of its own: what a certificate is
 * allowed to do is decided by the contracts.
 */
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

// Maps a stakeholder name onto one of the enrolled network identities.
//
// One per role, so every step of a batch's journey is signed by a different certificate and the
// registry's role checks are doing real work rather than being waved through by a single caller.
// The last two come from `pnpm fabric:enrol-identities`, because the test network is generated
// with only two users per organisation.
const DEMO_IDENTITIES: Record<string, { org: "org1" | "org2"; user: string }> = {
  regulator: { org: "org1", user: "Admin" },
  oracle: { org: "org1", user: "User1" },
  farm: { org: "org1", user: "User2" },
  retailer: { org: "org2", user: "Admin" },
  logistics: { org: "org2", user: "User1" },
  processor: { org: "org2", user: "User2" }
};

export function getDemoIdentity(name: string): DemoIdentity {
  const normalised = name.trim().toLowerCase();
  // Checked with hasOwn rather than a plain lookup: an inherited key such as 'constructor' would
  // otherwise return a truthy value off the prototype and slip past the guard below.
  const mapping = Object.hasOwn(DEMO_IDENTITIES, normalised)
    ? DEMO_IDENTITIES[normalised]
    : undefined;
  if (!mapping) {
    throw new Error(
      `Unknown demo identity '${name}'. Expected one of: ${Object.keys(DEMO_IDENTITIES).join(", ")}.`
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
      `Missing ${DEMO_IDENTITY_HEADER} header. Expected one of: ${Object.keys(DEMO_IDENTITIES).join(", ")}.`
    );
  }

  return getDemoIdentity(header);
}

