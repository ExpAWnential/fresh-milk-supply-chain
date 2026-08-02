# Fabric Network

TypeScript wrappers around the local Hyperledger Fabric network lifecycle. They shell out to
Fabric's `test-network`, which supplies the two organisations the design calls for, with Org1
acting as the regulator.

- `pnpm fabric:start` brings the network up with CouchDB and creates the channel.
- `pnpm fabric:deploy-chaincode` packages and commits both chaincodes.
- `pnpm fabric:stop` tears the network down, removing the ledger.

Set `FABRIC_TEST_NETWORK_PATH` if `test-network` is not in the default location.
