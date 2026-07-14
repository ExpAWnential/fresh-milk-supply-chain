# Architecture

## Planned Components

This proof of concept is planned as a permissioned Hyperledger Fabric network with TypeScript packages for chaincode, backend services and oracle processing.

## Fabric Network

The `fabric/network` package will contain TypeScript wrapper scripts for local network lifecycle operations. These wrappers are expected to call Fabric CLI and Docker commands once the network topology is chosen.

TODO: Define organizations, peers, orderers, channel names and chaincode deployment flow.

## Chaincode

Two chaincodes are deployed to the channel, not one. This keeps the stakeholder registry independently deployable and lets the supply-chain contracts delegate role checks to it through a cross-chaincode invocation, rather than trusting role data held in their own state.

`fabric/chaincode/stakeholder` contains:

- `StakeholderRegistryContract`

`fabric/chaincode/supplychain` contains:

- `BatchLifecycleContract`
- `TemperatureComplianceContract`

Each chaincode is packaged and installed on the peers as a standalone module, so shared helpers are duplicated per package rather than imported from a workspace package, which would not resolve inside the chaincode container.

TODO: Implement on-chain validation, ledger state models, cross-chaincode role checks and event emission.

## Backend

The `services/backend` package will expose REST endpoints and use Fabric Gateway to submit and evaluate transactions. It also reads the off-chain database to serve evidence verification.

TODO: Add gateway connection configuration, identity handling and route handlers.

## Oracle

The `services/oracle` package will canonicalise temperature readings, calculate statistics, hash raw evidence, persist the raw readings off-chain and submit the summary on-chain under the ORACLE identity.

TODO: Add CSV ingestion and confirm the oracle submits directly through Fabric Gateway rather than through the backend.

## Off-Chain Storage

The `services/storage` package holds the PostgreSQL schema and repository interfaces for raw temperature readings, evidence records and supporting documents. Only the evidence hash, the off-chain reference, the computed statistics and the compliance outcome are written to the ledger.

Evidence rows are written as `PENDING` and only marked `ANCHORED` once the Fabric transaction is confirmed, so a failed submission is never mistaken for anchored evidence.

TODO: Implement the repositories and the hash verification query.
