# Setup

## Prerequisites

- Node.js 20 or newer.
- pnpm 9 or newer.
- Docker for local Hyperledger Fabric containers.
- Hyperledger Fabric binaries and container images.

## Install

```bash
pnpm install
```

## Build

```bash
pnpm build
```

## Planned Local Network Commands

```bash
pnpm fabric:start
pnpm fabric:deploy-chaincode
pnpm fabric:stop
```

These commands currently call placeholder TypeScript scripts. They should be connected to the selected Fabric topology in a later step.

## Secrets And Generated Files

Do not commit Fabric certificates, private keys, generated channel artifacts, wallets, SQLite database files or dependency directories.
