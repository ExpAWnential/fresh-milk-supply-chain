# Architecture

## Planned Components

This proof of concept is planned as a permissioned Hyperledger Fabric network with TypeScript packages for chaincode, backend services and oracle processing.

## Fabric Network

The `fabric/network` package will contain TypeScript wrapper scripts for local network lifecycle operations. These wrappers are expected to call Fabric CLI and Docker commands once the network topology is chosen.

TODO: Define organizations, peers, orderers, channel names and chaincode deployment flow.

## Chaincode

The `fabric/chaincode` package contains placeholder contracts for:

- `StakeholderRegistryContract`
- `BatchLifecycleContract`
- `TemperatureComplianceContract`

TODO: Implement on-chain validation, ledger state models and event emission.

## Backend

The `services/backend` package will expose REST endpoints and use Fabric Gateway to submit and evaluate transactions.

TODO: Add gateway connection configuration, identity handling and route handlers.

## Oracle

The `services/oracle` package will canonicalise temperature readings, calculate statistics, hash raw evidence and submit compliant summaries on-chain.

TODO: Add CSV ingestion and backend or gateway submission strategy.
