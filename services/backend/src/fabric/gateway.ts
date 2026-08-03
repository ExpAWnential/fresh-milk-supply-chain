/**
 * Opens Fabric Gateway connections with one organisation's certificate and private key.
 *
 * Request clients use explicit deadlines and close their gRPC connection after use. Event streams
 * stay open and resume from a checkpoint so the regulator can continue archiving after a restart.
 */
import { credentials, Client } from "@grpc/grpc-js";
import {
  checkpointers,
  connect,
  hash,
  signers,
  type ChaincodeEvent,
  type Gateway,
  type Signer
} from "@hyperledger/fabric-gateway";
import { createPrivateKey } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config.js";
import type { OrganisationIdentity } from "../organisations.js";

export interface FabricGatewayClient {
  // A chaincode may expose multiple contracts, so both names are required.
  submitTransaction(
    chaincodeName: string,
    contractName: string,
    transactionName: string,
    ...args: string[]
  ): Promise<Uint8Array>;
  evaluateTransaction(
    chaincodeName: string,
    contractName: string,
    transactionName: string,
    ...args: string[]
  ): Promise<Uint8Array>;
  close(): void;
}

interface Wallet {
  readonly certificate: Buffer;
  readonly tlsRootCert: Buffer;
  readonly signer: Signer;
}

// Fabric generates unpredictable wallet filenames, but each expected directory contains one file.
export async function singleFileIn(directory: string): Promise<string> {
  const entries = (await readdir(directory)).filter((entry) => !entry.startsWith("."));
  if (entries.length !== 1) {
    throw new Error(`Expected exactly one file in ${directory}, found ${entries.length}.`);
  }

  return join(directory, entries[0]);
}

// Wallet material is immutable for the process lifetime, so load it once per path pair.
const wallets = new Map<string, Promise<Wallet>>();

function loadWallet(identity: OrganisationIdentity): Promise<Wallet> {
  // Cache by source paths so identities with the same name cannot share unrelated material.
  const key = `${identity.userPath}\u0000${identity.peerTlsCaPath}`;
  const cached = wallets.get(key);
  if (cached) {
    return cached;
  }

  const loading = (async (): Promise<Wallet> => {
    const [certificatePath, privateKeyPath] = await Promise.all([
      singleFileIn(join(identity.userPath, "signcerts")),
      singleFileIn(join(identity.userPath, "keystore"))
    ]);
    const [certificate, privateKey, tlsRootCert] = await Promise.all([
      readFile(certificatePath),
      readFile(privateKeyPath),
      readFile(identity.peerTlsCaPath)
    ]);

    return {
      certificate,
      tlsRootCert,
      signer: signers.newPrivateKeySigner(createPrivateKey(privateKey))
    };
  })();

  // Do not cache failures because wallet files may appear after process startup.
  loading.catch(() => wallets.delete(key));
  wallets.set(key, loading);
  return loading;
}

function createGrpcClient(identity: OrganisationIdentity, tlsRootCert: Buffer): Client {
  return new Client(
    identity.peerEndpoint,
    credentials.createSsl(tlsRootCert),
    // TLS verifies the peer's network hostname even though development connects through localhost.
    { "grpc.ssl_target_name_override": identity.peerHostAlias }
  );
}

// Fabric Gateway has no default deadlines. Commit status gets longer because it waits for a block.
const callDeadlines = {
  evaluateOptions: () => ({ deadline: Date.now() + 30_000 }),
  endorseOptions: () => ({ deadline: Date.now() + 30_000 }),
  submitOptions: () => ({ deadline: Date.now() + 30_000 }),
  commitStatusOptions: () => ({ deadline: Date.now() + 60_000 })
};

export type GatewayOpener = (options: Parameters<typeof connect>[0]) => Gateway;

export interface LedgerEventStream {
  readonly events: AsyncIterable<ChaincodeEvent>;
  checkpoint(event: ChaincodeEvent): Promise<void>;
  close(): void;
}

/**
 * Opens the regulator's long-lived chaincode event stream.
 * Unlike request clients it has no deadline, and it resumes from a durable checkpoint after restart.
 */
export async function createLedgerEventStream(
  identity: OrganisationIdentity,
  chaincodeName: string,
  checkpointFile: string,
  openGateway: GatewayOpener = connect
): Promise<LedgerEventStream> {
  const wallet = await loadWallet(identity);
  const client = createGrpcClient(identity, wallet.tlsRootCert);

  let gateway: Gateway;
  try {
    gateway = openGateway({
      client,
      identity: { mspId: identity.mspId, credentials: wallet.certificate },
      signer: wallet.signer,
      hash: hash.sha256
    });
  } catch (error) {
    client.close();
    throw error;
  }

  // Close the connection if checkpoint setup or subscription fails before a stream is returned.
  let checkpointer: Awaited<ReturnType<typeof checkpointers.file>>;
  let events: Awaited<ReturnType<ReturnType<Gateway["getNetwork"]>["getChaincodeEvents"]>>;
  try {
    checkpointer = await checkpointers.file(checkpointFile);
    events = await gateway
      .getNetwork(config.fabricChannelName)
      // A new listener starts at genesis. Existing listeners resume from their checkpoint.
      .getChaincodeEvents(chaincodeName, {
        checkpoint: checkpointer,
        startBlock: BigInt(0)
      });
  } catch (error) {
    gateway.close();
    client.close();
    throw error;
  }

  return {
    events,
    async checkpoint(event: ChaincodeEvent): Promise<void> {
      await checkpointer.checkpointChaincodeEvent(event);
    },
    close(): void {
      events.close();
      gateway.close();
      client.close();
    }
  };
}

/**
 * Opens a request-scoped gateway for one organisation's fixed identity.
 * Closing the returned client also releases its gateway and underlying gRPC connection.
 */
export async function createFabricGatewayClient(
  identity: OrganisationIdentity,
  openGateway: GatewayOpener = connect
): Promise<FabricGatewayClient> {
  const wallet = await loadWallet(identity);
  const client = createGrpcClient(identity, wallet.tlsRootCert);

  let gateway: Gateway;
  try {
    gateway = openGateway({
      client,
      identity: { mspId: identity.mspId, credentials: wallet.certificate },
      signer: wallet.signer,
      hash: hash.sha256,
      ...callDeadlines
    });
  } catch (error) {
    client.close();
    throw error;
  }

  const network = gateway.getNetwork(config.fabricChannelName);
  let closed = false;

  return {
    async submitTransaction(chaincodeName, contractName, transactionName, ...args) {
      return network
        .getContract(chaincodeName, contractName)
        .submitTransaction(transactionName, ...args);
    },

    async evaluateTransaction(chaincodeName, contractName, transactionName, ...args) {
      return network
        .getContract(chaincodeName, contractName)
        .evaluateTransaction(transactionName, ...args);
    },

    close(): void {
      if (closed) {
        return;
      }
      closed = true;
      gateway.close();
      client.close();
    }
  };
}
