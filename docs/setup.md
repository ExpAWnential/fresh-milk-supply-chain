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

The network is part of this repository, under `fabric/milk-network`. One command brings up all
six organisations and creates the channel. Every peer runs CouchDB, which the traceability
queries need.

```bash
pnpm fabric:start
```

Check it with `docker ps`. You should see thirteen containers: one orderer, and a `peer0` and a
`couchdb` for each of the six companies.

## 4. Start the off-chain database

```bash
pnpm db:start
```

Runs PostgreSQL in Docker and applies `services/storage/schema.sql` on first start.
The backend uses this connection by default:

```text
postgres://freshmilk:freshmilk@localhost:5432/freshmilk
```

Set `DATABASE_URL` to use a different database.

## Evidence verification and tampering demo

Once the oracle has saved evidence and its Fabric transaction has been confirmed, verify that
the off-chain readings still match the anchored hash:

```bash
curl http://localhost:3000/temperature/evidence/TEMP-TRIP-001/verify
```

The response reports `match: true` for unchanged readings and `match: false` after tampering.
Until the Fabric Gateway implementation is connected, the endpoint uses the hash from the
database record only when that record is marked `ANCHORED` and has a Fabric transaction ID.
It also accepts a Fabric-backed hash reader, which takes precedence when integration is ready.

The demonstration command intentionally changes the first stored reading for one evidence
record. The confirmation flag prevents accidental use:

```bash
pnpm demo:tamper -- --evidence TEMP-TRIP-001 --delta 1 --confirm-tamper
```

It prints the anchored hash and the recomputed values before and after the change, ending with
`HASH_MISMATCH`.

## Stopping

```bash
pnpm fabric:stop                                         # blockchain (wipes ledger data)
pnpm db:stop                                             # database
```

## Organisations

Each of the six companies is its own organisation, with its own certificate authority, peer and
database, defined under `fabric/milk-network`. Bringing the network up generates a certificate for
each, so there is no separate enrolment step.

Only Fabric's binaries and its default `core.yaml` come from `~/fabric-samples`. Set
`FABRIC_SAMPLES_HOME` if yours is installed somewhere else.

## Deploying the project chaincode

```bash
pnpm fabric:deploy-chaincode
```

Builds, packages, installs, approves and commits both chaincodes on the channel. A committed
definition can only be replaced by a higher sequence number, so redeploying after a code change
needs both values raised:

```bash
pnpm fabric:deploy-chaincode -- --version 1.1 --sequence 2
```

## Secrets and generated files

Do not commit Fabric certificates, private keys, generated channel artifacts, wallets,
database volumes or dependency directories.
