export interface FabricGatewayClient {
  submitTransaction(contractName: string, transactionName: string, ...args: string[]): Promise<Uint8Array>;
  evaluateTransaction(contractName: string, transactionName: string, ...args: string[]): Promise<Uint8Array>;
}

export async function createFabricGatewayClient(): Promise<FabricGatewayClient> {
  // TODO: Create a Fabric Gateway connection using configured identity, signer, TLS and peer endpoint.
  throw new Error("createFabricGatewayClient is not implemented yet.");
}
