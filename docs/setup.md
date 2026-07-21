# Setup

Steps to get a working blockchain and database running locally.

## Prerequisites

- Node.js 20 or newer.
- Docker Desktop, installed and running.

## 1. Get the project dependencies

```bash
pnpm install
```

## 2. Download Hyperledger Fabric

This pulls Fabric's sample network, its command-line tools and the Docker images.
Run it once. It installs into `~/fabric-samples`.

```bash
cd ~
curl -sSL https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh | bash -s docker binary samples
```

## 3. Start the blockchain

We build on Fabric's `test-network`. `-s couchdb` gives the searchable database the
project relies on for traceability queries.

```bash
cd ~/fabric-samples/test-network
./network.sh up -s couchdb
./network.sh createChannel -c milkchannel
```

Check it is running with `docker ps`. You should see `orderer`, two `peer0` and two
`couchdb` containers.

## 4. Start the off-chain database

```bash
pnpm db:start
```

Runs PostgreSQL in Docker and applies `services/storage/schema.sql` on first start.

## Stopping

```bash
cd ~/fabric-samples/test-network && ./network.sh down   # blockchain (wipes ledger data)
pnpm db:stop                                             # database
```

## Deploying the project chaincode

Not wired up yet. The `stakeholder` and `supplychain` chaincodes are still being built.
Deployment uses `test-network`'s `./network.sh deployCC`; the exact command will be added
here once the first chaincode is ready to deploy.

## Secrets and generated files

Do not commit Fabric certificates, private keys, generated channel artifacts, wallets,
database volumes or dependency directories.
