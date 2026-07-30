# COMP6452
Fresh Milk Supply Chain

A permissioned Hyperledger Fabric proof of concept for a fresh-milk cold chain. Milk is tracked
from the farm to the shelf, temperature readings are anchored on the ledger so they cannot be
altered unnoticed, and a shopper can look up a carton without holding any blockchain identity.

## What is in here

- **Two chaincodes.** `stakeholder` is the registry of companies and their roles. `supplychain`
  holds the batch lifecycle and temperature compliance, and asks the registry whether the caller
  is allowed to do what they are asking.
- **A backend.** An Express service that reaches both chaincodes through the Fabric Gateway,
  signing as whichever company made the request. It also listens to the chain's own events.
- **An oracle.** Reads sensor data, stores the readings off-chain and anchors a fingerprint of
  them on the ledger.
- **PostgreSQL.** Holds the bulky readings. Only the fingerprint and a summary go on-chain.
- **Network automation.** Scripts to start the network, issue identities and deploy the chaincode.

There is no graphical interface. The brief allows REST endpoints and a scripted demo instead.

## Getting started

You need Docker running, Node 22, pnpm, and Hyperledger Fabric's binaries and test network in
`~/fabric-samples`. `docs/setup.md` covers installing those and the tampering demo in full.

Run these in order, from the repository root.

```bash
pnpm install                      # dependencies
pnpm build                        # compile every package

pnpm fabric:start                 # bring up the Fabric network
pnpm fabric:enrol-identities      # issue a certificate for each of the six roles
pnpm fabric:deploy-chaincode      # install and commit both chaincodes

pnpm db:start                     # off-chain PostgreSQL
pnpm backend:dev                  # the API, on port 3000
```

The registry starts empty, and every registration needs an existing regulator to authorise it, so
create the first one before anything else:

```bash
curl -X POST http://localhost:3000/stakeholders/bootstrap \
  -H 'content-type: application/json' \
  -H 'x-demo-identity: regulator' \
  -d '{"stakeholderId":"regulator-001"}'
```

From there the regulator registers the other companies, and `pnpm oracle:dev` reads a readings
file and anchors it. `pnpm fabric:stop` and `pnpm db:stop` shut everything down.

## Identities

Each of the six roles signs with its own certificate, so every step of a batch's journey is
authorised by a different company and the registry's role checks are doing real work.

Requests say who they are with an `x-demo-identity` header, one of `regulator`, `farm`,
`processor`, `logistics`, `retailer` or `oracle`. That is a demo convenience: the header only
chooses which certificate signs, and the contracts make every decision from the certificate Fabric
verified, never from anything the request claims about itself.

## Other commands

```bash
pnpm test         # the whole test suite
pnpm typecheck    # types across every package
pnpm demo:tamper  # alter a stored reading, then verify it to see the mismatch
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
- The contract decides the compliance outcome, not the oracle, and the off-chain record takes that
  verdict from the ledger's own events.
- Unsafe evidence must mark the batch as `COLD_CHAIN_BREACH`.
- A breached or recalled batch cannot be delivered.
- The regulator can recall a batch.
- Every event must include the Fabric transaction ID, transaction timestamp and invoking
  stakeholder identity.
- Certificates, private keys and generated blockchain artifacts are never committed.
