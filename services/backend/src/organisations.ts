/**
 * The six companies on the network: who they are, where their peer is, and which port their own
 * backend listens on.
 *
 * Each company runs its own backend process holding only its own private key. This table is how a
 * process finds itself, and how it describes the rest of the consortium to the demo page.
 */
import { join } from "node:path";

// What a company keeps off-chain, if anything. Only two of the six do, and they keep different
// things in separate databases. Declared here rather than decided by name at each wiring point,
// so moving the archive or adding a company is an edit to this table and nowhere else.
export type OffChainStore = "readings" | "verdicts";

export interface Organisation {
  readonly name: string;
  readonly domain: string;
  readonly mspId: string;
  readonly peerEndpoint: string;
  // The ID this company is registered under in the stakeholder registry.
  readonly stakeholderId: string;
  readonly backendPort: number;
  readonly offChainStore?: OffChainStore;
}

// An organisation plus the paths to the wallet material it signs with.
export interface OrganisationIdentity extends Organisation {
  readonly userPath: string;
  readonly peerHostAlias: string;
  readonly peerTlsCaPath: string;
}

// One organisation per company, matching fabric/milk-network/scripts/orgs.sh. Each has its own
// certificate authority, so no company can issue an identity for another.
//
// The regulator is first because it has to be bootstrapped before it can register anybody.
export const ORGANISATIONS: readonly Organisation[] = [
  {
    name: "regulator",
    domain: "regulator.example.com",
    mspId: "RegulatorMSP",
    peerEndpoint: "localhost:7051",
    stakeholderId: "regulator-001",
    backendPort: 3001,
    offChainStore: "verdicts"
  },
  {
    name: "farm",
    domain: "farm.example.com",
    mspId: "FarmMSP",
    peerEndpoint: "localhost:8051",
    stakeholderId: "farm-001",
    backendPort: 3002
  },
  {
    name: "processor",
    domain: "processor.example.com",
    mspId: "ProcessorMSP",
    peerEndpoint: "localhost:9051",
    stakeholderId: "processor-001",
    backendPort: 3003
  },
  {
    name: "logistics",
    domain: "logistics.example.com",
    mspId: "LogisticsMSP",
    peerEndpoint: "localhost:10051",
    stakeholderId: "logistics-001",
    backendPort: 3004
  },
  {
    name: "retailer",
    domain: "retailer.example.com",
    mspId: "RetailerMSP",
    peerEndpoint: "localhost:11051",
    stakeholderId: "retailer-001",
    backendPort: 3005
  },
  {
    name: "oracle",
    domain: "oracle.example.com",
    mspId: "OracleMSP",
    peerEndpoint: "localhost:12051",
    stakeholderId: "oracle-001",
    backendPort: 3006,
    offChainStore: "readings"
  }
];

// A Map rather than an object, so a lookup for an inherited key such as 'constructor' misses
// instead of returning something off the prototype.
const byName = new Map(ORGANISATIONS.map((organisation) => [organisation.name, organisation]));

export const ORGANISATION_NAMES: readonly string[] = ORGANISATIONS.map(
  (organisation) => organisation.name
);

// Where a company's backend answers. Built in one place because two of the callers have to agree:
// one builds the CORS allowlist and the other builds the directory the demo page dials. If those
// ever disagreed, every cross-company call would be rejected by the browser and reported as the
// backend being down, which names nothing.
export function originOf(organisation: Organisation): string {
  return `http://localhost:${organisation.backendPort}`;
}

// The company that publishes the raw readings. Everyone else fetches from it to run their own
// verification, so this is the one company the other five need to be able to find.
export function readingsHolder(): Organisation {
  const holder = ORGANISATIONS.find(
    (organisation) => organisation.offChainStore === "readings"
  );
  if (!holder) {
    throw new Error("No organisation is declared as holding the temperature readings.");
  }

  return holder;
}

export function findOrganisation(name: string): Organisation {
  const organisation = byName.get(name.trim().toLowerCase());
  if (!organisation) {
    throw new Error(
      `Unknown organisation '${name}'. Expected one of: ${ORGANISATION_NAMES.join(", ")}.`
    );
  }

  return organisation;
}

// Every company signs as its own User1. Deliberately not Admin: an organisation's administrator
// can change channel configuration, and no company's ordinary business traffic should be carrying
// that authority.
const NETWORK_USER = "User1";

export function walletFor(
  organisation: Organisation,
  organizationsPath: string
): OrganisationIdentity {
  const organisationPath = join(organizationsPath, organisation.domain);

  return {
    ...organisation,
    userPath: join(organisationPath, "users", `${NETWORK_USER}@${organisation.domain}`, "msp"),
    peerHostAlias: `peer0.${organisation.domain}`,
    peerTlsCaPath: join(organisationPath, "tlsca", `tlsca.${organisation.domain}-cert.pem`)
  };
}

// Which company this process is. Called from the entry point rather than at import time: as a
// module-level constant it would throw in every test that loads the app without ORGANISATION set.
export function resolveLocalOrganisation(
  env: NodeJS.ProcessEnv,
  organizationsPath: string
): OrganisationIdentity {
  const name = env.ORGANISATION?.trim();
  if (!name) {
    throw new Error(
      `Set ORGANISATION to the company this backend acts for, one of: ` +
        `${ORGANISATION_NAMES.join(", ")}.`
    );
  }

  return walletFor(findOrganisation(name), organizationsPath);
}
