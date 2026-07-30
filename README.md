# COMP6452
Fresh Milk Supply Chain

## Overview

This repository is a TypeScript monorepo scaffold for a permissioned Hyperledger Fabric proof of concept for a fresh-milk cold-chain supply chain.

The architecture:

- Hyperledger Fabric network automation.
- Two Fabric chaincodes: `stakeholder` (registry) and `supplychain` (batch lifecycle and temperature compliance). The supply-chain contracts delegate role checks to the stakeholder registry through a cross-chaincode invocation.
- An Express backend that reaches both chaincodes through the Fabric Gateway.
- A separate temperature oracle service.
- PostgreSQL off-chain storage for raw temperature readings.
- REST endpoints and terminal output for demonstration instead of a GUI.

## Current Scope

The business logic is implemented and runs against a local Fabric network. Both chaincodes are
deployed, the backend reaches them through the Fabric Gateway, the oracle stores readings in
PostgreSQL and anchors their fingerprint on-chain, and altering a stored reading is detected.

Not included:

- A graphical interface. The brief allows a REST interface and a scripted demo instead.
- Fabric certificates, private keys or generated blockchain artifacts, which the network
  generates locally and which are never committed.

## Commands

Install dependencies:

```bash
pnpm install
```

Build all packages:

```bash
pnpm build
```

Typecheck all packages:

```bash
pnpm typecheck
```

Start the Fabric network:

```bash
pnpm fabric:start
```

Deploy both chaincodes:

```bash
pnpm fabric:deploy-chaincode
```

Start and stop the off-chain PostgreSQL database:

```bash
pnpm db:start
pnpm db:stop
```

Start the backend:

```bash
pnpm backend:dev
```

Start the oracle:

```bash
pnpm oracle:dev
```

## Business Rules

- Only a regulator may register, update or suspend stakeholders.
- Stakeholders are linked to their authenticated Fabric certificate IDs.
- Supported roles are `REGULATOR`, `FARM`, `PROCESSOR`, `LOGISTICS`, `RETAILER` and `ORACLE`.
- Only `FARM` or `PROCESSOR` may create a milk batch.
- Batch lifecycle transitions must be validated on-chain.
- Invalid or out-of-order events must be rejected.
- Only `ORACLE` may submit temperature evidence.
- Raw temperature readings must remain off-chain in PostgreSQL.
- The oracle must canonicalise readings, calculate statistics and compute a SHA-256 hash.
- Only the hash, off-chain reference, statistics and compliance outcome are stored on-chain.
- Unsafe evidence must mark the batch as `COLD_CHAIN_BREACH`.
- A breached or recalled batch cannot be delivered.
- The regulator can recall a batch.
- Every event must include the Fabric transaction ID, transaction timestamp and invoking stakeholder identity.
