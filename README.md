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
- **The network itself.** Six organisations, one per company, defined in this repository rather
  than borrowed from Fabric's samples, with scripts to bring them up and deploy the chaincode.

There is no graphical interface. The brief allows REST endpoints and a scripted demo instead.

## Getting started

You need Docker running with at least 8 GB of memory, Node 22, pnpm, and Hyperledger Fabric's
binaries in `~/fabric-samples`. The network itself is in this repository; only the binaries come
from there. `docs/setup.md` covers installing them and the tampering demo in full.

The first deploy builds each chaincode once per organisation, so expect it to take several
minutes.

Run these in order, from the repository root.

```bash
pnpm install                      # dependencies
pnpm build                        # compile every package

pnpm fabric:start                 # bring up the six-organisation Fabric network
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

## Organisations and identities

Each of the six companies is its own Fabric organisation, with its own certificate authority, peer
and database. No company's authority can issue an identity for another, and the regulator does not
share one with the farm and oracle it regulates.

| Company | Organisation | Peer |
| --- | --- | --- |
| regulator | `RegulatorMSP` | localhost:7051 |
| farm | `FarmMSP` | localhost:8051 |
| processor | `ProcessorMSP` | localhost:9051 |
| logistics | `LogisticsMSP` | localhost:10051 |
| retailer | `RetailerMSP` | localhost:11051 |
| oracle | `OracleMSP` | localhost:12051 |

Every transaction needs a majority of those six to run the contract independently and agree, and
temperature evidence additionally requires the regulator's own peer to be one of them. Four
organisations satisfy the majority on their own, so without that second rule the other five could
record a cold-chain verdict the regulator never saw.

Requests say who they are with an `x-demo-identity` header, one of `regulator`, `farm`,
`processor`, `logistics`, `retailer` or `oracle`. That is a demo convenience: the header only
chooses which certificate signs, and the contracts make every decision from the certificate Fabric
verified, never from anything the request claims about itself. In a real deployment each company
would run its own backend holding only its own certificate, and the header would not exist.

## Other commands

```bash
pnpm test         # the whole test suite
pnpm typecheck    # types across every package
pnpm demo:tamper  # alter a stored reading, then verify it to see the mismatch
```

## Demo

With the network, database and backend running, open <http://localhost:3000>.

Choose which company you are signing as, choose a batch, and drive the system in any order. Every
request and the contract's own reply are shown, so a refusal reads as a refusal rather than a fault.
**Set up demo** registers the regulator and the five other companies in one go, deriving each one's
certificate ID from the certificates the network generated.

Temperature evidence comes from the oracle rather than from the page. The oracle stores the readings
off-chain and anchors the fingerprint in the same run, so submitting evidence from a browser would
put a record on the ledger with nothing behind it:

```bash
pnpm oracle:dev                            # compliant readings for BATCH-001
pnpm oracle:dev data/unsafe-readings.csv   # a cold-chain breach for BATCH-002
```

Tampering is done straight against PostgreSQL, deliberately going around the application:

```bash
pnpm demo:tamper --evidence <evidence-id> --confirm-tamper
```

Press **Show evidence** again afterwards and the off-chain panel has changed while the anchored hash
has not.

## Business Rules

- Only a regulator may register, update or suspend stakeholders.
- Stakeholders are linked to their authenticated Fabric certificate IDs.
- Supported roles are `REGULATOR`, `FARM`, `PROCESSOR`, `LOGISTICS`, `RETAILER` and `ORACLE`.
- Only a `FARM` may create a milk batch, because that is where milk enters the chain and the
  origin recorded at creation is never changed afterwards.
- Batch lifecycle transitions must be validated on-chain.
- Invalid or out-of-order events must be rejected.
- Only `ORACLE` may submit temperature evidence, and the regulator's own peer must endorse it.
- Raw temperature readings must remain off-chain in PostgreSQL.
- The oracle must canonicalise readings, calculate statistics and compute a SHA-256 hash.
- Only the hash, off-chain reference, statistics and compliance outcome are stored on-chain.
- The contract decides the compliance outcome, not the oracle, and the off-chain record takes that
  verdict from the ledger's own events.
- Temperature evidence may be submitted at any stage of a batch's life, because milk has to stay
  cold from the farm's tank to the retailer's fridge, not only in the truck. A recalled batch is
  the exception, since it has been withdrawn.
- Unsafe evidence must mark the batch as `COLD_CHAIN_BREACH`.
- Clearing a breach returns the batch to the stage it was at when the breach was recorded.
- A breached or recalled batch cannot be delivered.
- The regulator can recall a batch.
- Every event must include the Fabric transaction ID, transaction timestamp and invoking
  stakeholder identity.
- Certificates, private keys and generated blockchain artifacts are never committed.
