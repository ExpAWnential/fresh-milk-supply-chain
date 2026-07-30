import { credentials, Client } from "@grpc/grpc-js";
import { connect, hash, signers, type Gateway, type Signer } from "@hyperledger/fabric-gateway";
import { createPrivateKey } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config.js";
import type { DemoIdentity } from "../demoIdentity.js";

export interface FabricGatewayClient {
  // Chaincode and contract are both required: the supply-chain chaincode holds two contracts, so
  // the transaction name alone does not identify what to call.
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

// Fabric names the certificate and key files unpredictably, so the single file in each directory
// is used rather than a hardcoded filename.
async function singleFileIn(directory: string): Promise<string> {
  const entries = (await readdir(directory)).filter((entry) => !entry.startsWith("."));
  if (entries.length !== 1) {
    throw new Error(`Expected exactly one file in ${directory}, found ${entries.length}.`);
  }

  return join(directory, entries[0]);
}

// The wallet is read once per identity and kept. A connection is still made per request, but the
// certificate and key never change while the process runs, so re-reading and re-parsing them on
// every call is pure waste.
const wallets = new Map<string, Promise<Wallet>>();

function loadWallet(identity: DemoIdentity): Promise<Wallet> {
  // Keyed by the paths it actually reads, not by the identity name, so the cache can never return
  // material loaded from somewhere else.
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

  // Only a successful load is remembered, so a missing file is reported again next time rather
  // than being cached as a permanent failure.
  loading.catch(() => wallets.delete(key));
  wallets.set(key, loading);
  return loading;
}

function createGrpcClient(identity: DemoIdentity, tlsRootCert: Buffer): Client {
  return new Client(
    identity.peerEndpoint,
    credentials.createSsl(tlsRootCert),
    // The peer's certificate is issued to its network hostname, which does not match the
    // localhost address the port is published on.
    { "grpc.ssl_target_name_override": identity.peerHostAlias }
  );
}

// fabric-gateway applies no deadline of its own, so a peer or orderer that stalls holds the
// request open forever and the gRPC channel behind it is never released. Waiting for a block to
// be cut is the slowest step, which is why it gets the longest of these.
const callDeadlines = {
  evaluateOptions: () => ({ deadline: Date.now() + 30_000 }),
  endorseOptions: () => ({ deadline: Date.now() + 30_000 }),
  submitOptions: () => ({ deadline: Date.now() + 30_000 }),
  commitStatusOptions: () => ({ deadline: Date.now() + 60_000 })
};

export async function createFabricGatewayClient(
  identity: DemoIdentity
): Promise<FabricGatewayClient> {
  const wallet = await loadWallet(identity);
  const client = createGrpcClient(identity, wallet.tlsRootCert);

  let gateway: Gateway;
  try {
    gateway = connect({
      client,
      identity: { mspId: identity.mspId, credentials: wallet.certificate },
      signer: wallet.signer,
      hash: hash.sha256,
      ...callDeadlines
    });
  } catch (error) {
    // The channel is already open at this point, and nothing else would ever close it.
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
