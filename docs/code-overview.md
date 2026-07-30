# Code Overview

A walkthrough of the codebase from the ground up, for anyone reading it for the first time.

## What the project is

It tracks a carton of milk from the farm to the shop shelf, using a blockchain so nobody can
quietly rewrite the record afterwards. It is a university proof of concept (COMP6452), not a
product. There is no UI, just a REST API and scripts.

The problem it solves: milk has to stay cold. If it gets too warm in a truck, someone might be
tempted to erase that from the record. Here, the temperature evidence is locked onto a shared
ledger that no single company controls.

## The one idea you need first

**Hyperledger Fabric** is a private blockchain. Think of it as a shared notebook that several
companies keep together:

- Everyone has a copy, so nobody can edit their copy in secret.
- Every entry is signed with a certificate, so you always know which company wrote it.
- Entries are append-only. You can add a correction, but you can never delete history.

**Chaincode** (also called a smart contract) is code that runs *inside* the blockchain. It is the
gatekeeper. Before anything is written into the notebook, the chaincode checks the rules and
refuses if they are broken. This is the important bit: the rules are not in the app where someone
could bypass them, they are in the ledger itself.

## The five moving parts

```
   REST requests
        │
        ▼
  ┌───────────┐        ┌──────────────────────────┐
  │  Backend  │───────▶│  Fabric blockchain       │
  │ (Express) │        │   • stakeholder contract │
  └─────┬─────┘        │   • batch contract       │
        │              │   • temperature contract │
        │              └──────────────────────────┘
        ▼                          ▲
  ┌───────────┐                    │ summary + fingerprint only
  │ PostgreSQL│◀───────────────────┤
  │ (bulky    │   full readings    │
  │  readings)│              ┌─────┴──────┐
  └───────────┘◀─────────────│   Oracle   │
                             └────────────┘
```

1. **Two chaincode packages** (`fabric/chaincode/`) holding three contracts. This is the heart.
2. **Backend** (`services/backend/`) an Express API. It is a translator: HTTP in, blockchain
   transactions out.
3. **Oracle** (`services/oracle/`) stands in for the temperature logger on a truck. Reads a CSV of
   readings.
4. **Storage** (`services/storage/`) PostgreSQL, holds the thousands of raw readings.
5. **Network scripts** (`fabric/network/`) start Docker, issue certificates, deploy the chaincode.

It is a pnpm monorepo, all TypeScript, so each folder is its own package that the others can
import.

## Contract 1: the stakeholder registry

`fabric/chaincode/stakeholder/src/contracts/StakeholderRegistryContract.ts`

This is the who's who. Six roles: `REGULATOR`, `FARM`, `PROCESSOR`, `LOGISTICS`, `RETAILER`,
`ORACLE`.

Only a regulator can add, promote, suspend, or reactivate a company. Each company is tied to its
Fabric certificate, so nobody can sign in as someone else.

Three details worth understanding:

**The chicken-and-egg problem** (`bootstrapRegulator`, line 100). Registering anyone requires an
existing regulator, but a fresh ledger has none. So there is a one-shot function that creates the
very first regulator. It is guarded two ways: you must belong to the regulator organisation
(`Org1MSP`), and a flag on the ledger means it can only ever run once.

**The lockout guard** (lines 409-437). The registry keeps a counter of active regulators. If you
try to suspend or demote the last one, it refuses. Otherwise the system would brick itself with
nobody able to fix it.

**`assertActiveRole`** (line 250). This is the security guard the other two contracts call. You
hand it a certificate and a list of allowed roles, and it answers "yes, this is farm-001 and they
are allowed" or throws. Notice line 261: it checks the certificate you passed *matches the one
Fabric actually verified for this transaction*. You cannot ask "is farm-001 allowed?" while
signing as someone else.

## Contract 2: the batch lifecycle

`fabric/chaincode/supplychain/src/contracts/BatchLifecycleContract.ts`

A batch of milk walks a fixed path:

```
CREATED ──▶ PROCESSED ──▶ IN_TRANSIT ──▶ DELIVERED
                              │
                              ├──▶ COLD_CHAIN_BREACH
                              └──▶ RECALLED
```

Each step has one function, and each has two locks (see `transitionBatch`, line 231):

- **Who** — only `PROCESSOR` can process, only `LOGISTICS` can start transport, only `RETAILER`
  can take delivery.
- **When** — you can only move to `IN_TRANSIT` if the batch is currently `PROCESSED`. Steps cannot
  be skipped or reordered.

`recallBatch` lets a regulator pull a batch at any time. `getBatchHistory` replays every version
the batch has ever had, straight out of Fabric's own history.

## Contract 3: temperature compliance

`fabric/chaincode/supplychain/src/contracts/TemperatureComplianceContract.ts`

The rule is at the top: milk must stay between 0°C and 5°C.

The key design decision is line 62. The oracle sends its statistics, but the contract **works out
the verdict itself** rather than believing the oracle's word. If the range is breached, the
contract flips the batch to `COLD_CHAIN_BREACH` and fires an alert event. Since delivery requires
status `IN_TRANSIT`, a breached batch physically cannot be delivered until a regulator clears it.

## The fingerprint trick

Thousands of temperature readings are far too bulky for a blockchain, and blockchains are readable
by all members. So:

1. The oracle reads the readings and sorts them into one exact canonical order
   (`evidenceHash.ts`, line 23). Order matters, because a different order would give a different
   fingerprint for identical data.
2. It runs SHA-256 over that. You get a 64-character fingerprint that changes completely if any
   single reading changes by 0.001°C.
3. **Full readings go into PostgreSQL. Only the fingerprint, a min/max/average summary, and a
   pointer go onto the chain.**

Now the tamper demo works: read the readings back out of Postgres, hash them again, compare
against the fingerprint on the ledger. Change one row in the database and the hashes stop
matching, while the blockchain record sits there unchanged.

`evidenceVerification.ts` line 21 has the sharp comment about why: comparing the database's
readings against the database's own stored hash proves nothing, because a tamperer would change
both. The anchor has to come from the ledger.

## How a request actually flows

Say a retailer marks a batch delivered:

1. `POST /batches/BATCH-001/delivery` with header `x-demo-identity: retailer`.
2. The backend (`demoIdentity.ts`) maps "retailer" to a certificate on disk. This header is a demo
   shortcut, and the file says so plainly at line 85. Real systems would authenticate properly.
3. `gateway.ts` opens a signed gRPC connection to a Fabric peer using that certificate.
4. `recordDelivery` runs inside the chaincode.
5. It calls across to the stakeholder chaincode: "is this certificate an active RETAILER?"
6. It checks the batch is currently `IN_TRANSIT`.
7. If both pass, it writes the new state and emits an event. If either fails, the whole
   transaction is rejected and nothing is written.

The backend also runs a permanent listener (`index.ts` line 28) that watches for compliance events
coming off the chain and copies the ledger's verdict back into Postgres. Again, the chain is the
source of truth and the database follows it.

## Two things that trip people up

**`ctx`.** Every contract function takes `ctx` as its first parameter, and you never pass it in.
Fabric creates a fresh one per transaction and injects it. It carries two things: the caller's
verified identity (`ctx.clientIdentity`) and the door to the ledger (`ctx.stub`). It is the only
trusted input a permission check may be based on, because everything else is a string the caller
made up.

**Why `getTxTimestamp()` instead of `new Date()`.** A transaction runs on every endorsing peer
independently, and their results must match exactly or it is rejected. Two machines calling
`new Date()` would differ by milliseconds and the transaction would fail every time. The timestamp
and transaction ID on `ctx` are fixed in the original request, so every peer sees the same values.

## Where to read next

Read in this order: `StakeholderRegistryContract.ts` (permissions), then
`BatchLifecycleContract.ts` (the state machine), then `evidenceHash.ts` (the fingerprint), then
`runOracle.ts` (how they combine). The comments throughout explain *why* rather than restating the
code.
