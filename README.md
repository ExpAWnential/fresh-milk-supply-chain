# COMP6452
Fresh Milk Supply Chain

## Overview

This repository is a TypeScript monorepo scaffold for a permissioned Hyperledger Fabric proof of concept for a fresh-milk cold-chain supply chain.

The planned architecture includes:

- Hyperledger Fabric network automation.
- Fabric chaincode for stakeholder registration, batch lifecycle management and temperature compliance evidence.
- An Express backend that will use Fabric Gateway.
- A separate temperature oracle service.
- SQLite off-chain storage for raw temperature readings in a later step.
- REST endpoints, scripts and terminal output for demonstration instead of a GUI.

## Current Scope

This first setup step intentionally does not implement the full business logic. The code contains package scaffolding, placeholder interfaces and TODO comments for the planned contracts and services.

Not included yet:

- Demo scripts.
- Test folders.
- SQLite schema or repository implementation.
- Fabric certificates, private keys or generated blockchain artifacts.

## Expected Commands

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

Start the planned Fabric network wrapper:

```bash
pnpm fabric:start
```

Deploy chaincode through the planned Fabric wrapper:

```bash
pnpm fabric:deploy-chaincode
```

Start the backend:

```bash
pnpm backend:dev
```

Start the oracle:

```bash
pnpm oracle:dev
```

## Business Rules To Implement

- Only a regulator may register, update or suspend stakeholders.
- Stakeholders are linked to their authenticated Fabric certificate IDs.
- Supported roles are `REGULATOR`, `FARM`, `PROCESSOR`, `LOGISTICS`, `RETAILER` and `ORACLE`.
- Only `FARM` or `PROCESSOR` may create a milk batch.
- Batch lifecycle transitions must be validated on-chain.
- Invalid or out-of-order events must be rejected.
- Only `ORACLE` may submit temperature evidence.
- Raw temperature readings must remain off-chain in SQLite.
- The oracle must canonicalise readings, calculate statistics and compute a SHA-256 hash.
- Only the hash, off-chain reference, statistics and compliance outcome are stored on-chain.
- Unsafe evidence must mark the batch as `COLD_CHAIN_BREACH`.
- A breached or recalled batch cannot be delivered.
- The regulator can recall a batch.
- Every event must include the Fabric transaction ID, transaction timestamp and invoking stakeholder identity.
