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

// One organisation per company, matching fabric/milk-network/scripts/orgs.sh. Each has its own
// certificate authority, so no company can issue an identity for another.
const ORGANISATIONS: Record<string, OrganisationProfile> = {
  regulator: {
    domain: "regulator.example.com",
    mspId: "RegulatorMSP",
    peerEndpoint: "localhost:7051"
  },
  farm: {
    domain: "farm.example.com",
    mspId: "FarmMSP",
    peerEndpoint: "localhost:8051"
  },
  processor: {
    domain: "processor.example.com",
    mspId: "ProcessorMSP",
    peerEndpoint: "localhost:9051"
  },
  logistics: {
    domain: "logistics.example.com",
    mspId: "LogisticsMSP",
    peerEndpoint: "localhost:10051"
  },
  retailer: {
    domain: "retailer.example.com",
    mspId: "RetailerMSP",
    peerEndpoint: "localhost:11051"
  },
  oracle: {
    domain: "oracle.example.com",
    mspId: "OracleMSP",
    peerEndpoint: "localhost:12051"
  }
};

// Every role signs as its own organisation's User1. Deliberately not Admin: an organisation's
// administrator can change channel configuration, and no company's ordinary business traffic
// should be carrying that authority.
const DEMO_USER = "User1";

// Derived rather than restated, so a company cannot be added to one list and missed in the other.
// The order is the declaration order above, which puts the regulator first: it has to be
// bootstrapped before it can register anybody.
export const DEMO_IDENTITY_NAMES: readonly string[] = Object.keys(ORGANISATIONS);

export function getDemoIdentity(name: string): DemoIdentity {
  const normalised = name.trim().toLowerCase();
  // Checked with hasOwn rather than a plain lookup: an inherited key such as 'constructor' would
  // otherwise return a truthy value off the prototype and slip past the guard below.
  const organisation = Object.hasOwn(ORGANISATIONS, normalised)
    ? ORGANISATIONS[normalised]
    : undefined;
  if (!organisation) {
    throw new Error(
      `Unknown demo identity '${name}'. Expected one of: ${Object.keys(ORGANISATIONS).join(", ")}.`
    );
  }

  const organisationPath = join(config.fabricOrganizationsPath, organisation.domain);

  return {
    name: normalised,
    mspId: organisation.mspId,
    userPath: join(organisationPath, "users", `${DEMO_USER}@${organisation.domain}`, "msp"),
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
      `Missing ${DEMO_IDENTITY_HEADER} header. Expected one of: ${Object.keys(ORGANISATIONS).join(", ")}.`
    );
  }

  return getDemoIdentity(header);
}

