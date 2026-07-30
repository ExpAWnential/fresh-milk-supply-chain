import { credentials, Client } from "@grpc/grpc-js";
import { connect, hash, signers, type Gateway } from "@hyperledger/fabric-gateway";
import { createPrivateKey } from "node:crypto";
import { readFile } from "node:fs/promises";
import { config } from "../config.js";
import { readSingleFile, type DemoIdentity } from "../demoIdentity.js";

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

async function createGrpcClient(identity: DemoIdentity): Promise<Client> {
  const tlsRootCert = await readFile(identity.peerTlsCaPath);

  return new Client(
    identity.peerEndpoint,
    credentials.createSsl(tlsRootCert),
    // The peer's certificate is issued to its network hostname, which does not match the
    // localhost address the port is published on.
    { "grpc.ssl_target_name_override": identity.peerHostAlias }
  );
}

async function createGateway(identity: DemoIdentity, client: Client): Promise<Gateway> {
  const certificatePath = await readSingleFile(`${identity.userPath}/signcerts`);
  const privateKeyPath = await readSingleFile(`${identity.userPath}/keystore`);

  return connect({
    client,
    identity: {
      mspId: identity.mspId,
      credentials: await readFile(certificatePath)
    },
    signer: signers.newPrivateKeySigner(createPrivateKey(await readFile(privateKeyPath))),
    hash: hash.sha256
  });
}

export async function createFabricGatewayClient(
  identity: DemoIdentity
): Promise<FabricGatewayClient> {
  const client = await createGrpcClient(identity);
  const gateway = await createGateway(identity, client);
  const network = gateway.getNetwork(config.fabricChannelName);

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
      gateway.close();
      client.close();
    }
  };
}
