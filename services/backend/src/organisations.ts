/**
 * Defines the six consortium organisations and the local resources each backend may use.
 *
 * Peer addresses, public backend origins and wallet paths come from this one directory so the
 * browser client, CORS policy and Fabric connections cannot silently disagree about the topology.
 */
import { join } from "node:path";

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

// Keep the regulator first because registry setup must bootstrap it before registering the others.
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

const byName = new Map(ORGANISATIONS.map((organisation) => [organisation.name, organisation]));

export const ORGANISATION_NAMES: readonly string[] = ORGANISATIONS.map(
  (organisation) => organisation.name
);

// Shared by the CORS allowlist and the browser client's organisation directory.
export function originOf(organisation: Organisation): string {
  return `http://localhost:${organisation.backendPort}`;
}

// Locate the company that publishes raw readings for independent verification.
export function readingsHolder(): Organisation {
  const holder = ORGANISATIONS.find((organisation) => organisation.offChainStore === "readings");
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

// Ordinary backend traffic must not carry a channel administrator identity.
const NETWORK_USER = "User1";

/**
 * Selects a host-published or container-network peer address without changing the public origin.
 * Browser origins remain on localhost because CORS and the organisation directory are consumed
 * from the host, even when backend-to-peer traffic stays inside Compose.
 */
function peerEndpointFor(
  organisation: Organisation,
  peerHostAlias: string,
  env: NodeJS.ProcessEnv
): string {
  if (env.FABRIC_ADDRESS_MODE !== "container") {
    return organisation.peerEndpoint;
  }

  const port = organisation.peerEndpoint.split(":").at(-1);
  return `${peerHostAlias}:${port}`;
}

export function walletFor(
  organisation: Organisation,
  organizationsPath: string,
  env: NodeJS.ProcessEnv = process.env
): OrganisationIdentity {
  const organisationPath = join(organizationsPath, organisation.domain);
  const peerHostAlias = `peer0.${organisation.domain}`;

  return {
    ...organisation,
    peerEndpoint: peerEndpointFor(organisation, peerHostAlias, env),
    userPath: join(organisationPath, "users", `${NETWORK_USER}@${organisation.domain}`, "msp"),
    peerHostAlias,
    peerTlsCaPath: join(organisationPath, "tlsca", `tlsca.${organisation.domain}-cert.pem`)
  };
}

// Resolve at startup rather than import time so the app remains testable without an environment identity.
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

  return walletFor(findOrganisation(name), organizationsPath, env);
}
