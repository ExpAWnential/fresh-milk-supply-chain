# COMP6452

Fresh Milk Supply Chain

A permissioned Hyperledger Fabric proof of concept for a fresh-milk cold chain. Milk is tracked
from the farm to the shelf, temperature readings are anchored on the ledger so they cannot be
altered unnoticed, and a shopper can look up a carton without holding any blockchain identity.

## Run it

From the repository root:

```bash
docker compose up -d --build
```

Docker with 8 GB of memory is the only prerequisite. The console is on <http://localhost:3001>,
already registered and ready to use. The first run takes ten to twenty minutes, most of it building
a chaincode container per organisation. The image carries the built services, so `--build` is what
picks up changed or newly pulled code. `docker compose down -v` removes everything.

## What is in here

- **Two chaincodes.** `stakeholder` is the registry of companies and their roles. `supplychain`
  holds the batch lifecycle and temperature compliance, and asks the registry whether the caller
  is allowed to do what they are asking.
- **Six backends, one per company.** The same Express service run six times, each process holding
  only its own company's private key and talking only to its own peer. Nothing a caller sends can
  change which certificate signs, because no process holds another company's.
- **An oracle.** Reads sensor data, stores the readings off-chain and anchors a fingerprint of
  them on the ledger.
- **PostgreSQL.** Two databases, not one. The oracle keeps the bulky readings it collected. The
  regulator keeps an archive of the verdicts the ledger reached, built from the chain's own events.
  The other four companies store nothing off-chain.
- **The network itself.** Six organisations, one per company, defined in this repository rather
  than borrowed from Fabric's samples.
- **A demo console.** One React page served by all six backends, plus the REST API underneath it.

## Organisations and identities

Each of the six companies is its own Fabric organisation, with its own certificate authority and
peer. No company's authority can issue an identity for another, and the regulator does not share
one with the farm and oracle it regulates.

| Company | Organisation | Peer | Backend | Off-chain data |
| --- | --- | --- | --- | --- |
| regulator | `RegulatorMSP` | localhost:7051 | localhost:3001 | verdict archive |
| farm | `FarmMSP` | localhost:8051 | localhost:3002 | none |
| processor | `ProcessorMSP` | localhost:9051 | localhost:3003 | none |
| logistics | `LogisticsMSP` | localhost:10051 | localhost:3004 | none |
| retailer | `RetailerMSP` | localhost:11051 | localhost:3005 | none |
| oracle | `OracleMSP` | localhost:12051 | localhost:3006 | sensor readings |

Every transaction needs a majority of those six to run the contract independently and agree, and
temperature evidence additionally requires the regulator's own peer to be one of them. Four
organisations satisfy the majority on their own, so without that second rule the other five could
record a cold-chain verdict the regulator never saw.

Sending `POST /batches` to the retailer's backend on 3005 signs it as the retailer and the
chaincode refuses it, which is the same thing that would happen if the retailer wrote its own
client and skipped the backend entirely. Which endpoints a company exposes is a product decision.
Which transactions it may make is the contract's, and only the second is a control.

## Using the console

Open <http://localhost:3001>. All six backends serve the same page, so any of 3001 to 3006 will do.

Clicking a company chip is becoming that company: the next request goes to that company's own
backend, signed with that company's own certificate. One sentence at the top right narrates
whatever just happened, and the panel below it is the batch's real history on the ledger.

If the network is down, <http://localhost:3001/?mode=sim> is the same console over an in-memory
chain, with nothing real behind it.
