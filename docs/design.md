# Fresh Milk Cold-Chain PoC — Task 3 Design

## 1. What we are building

A working proof of concept for tracking fresh milk from farm to shop on a permissioned
blockchain, the design we selected in Task 2 (Hyperledger Fabric with sensitive data kept
off the chain).

It shows one complete story end to end: a regulator adds the companies to the system, a farm
creates a milk batch, each company records the batch moving along the chain, a temperature
sensor feed is checked, the full readings are stored off the chain while a short summary and a
fingerprint go on the chain, and the smart contracts decide whether the batch is allowed to
continue.

## 2. Changes from Task 2 to the Task 3 build

No specific feedback was received on the Task 2 presentation, so the changes below are
refinements the team made while turning the Task 2 design into a working build, not responses
to marker feedback. The earlier Task 1 feedback, making the requirements measurable and pinning
down what is stored on-chain, was already addressed in the Task 2 design.

| Change | Reason |
|---|---|
| Added a temperature sensor feed (oracle) | Required by Task 3, and cold-chain evidence needs a trusted source |
| Moved the rules inside the smart contracts | The contracts must make decisions, not just store data |
| Consumers no longer join the blockchain | They read a filtered public page instead, which is simpler and safer |
| Two contract packages instead of one | Removes any doubt about having at least two smart contracts |
| Turned on the searchable database inside Fabric | Needed for fast history lookups |
| One static control panel over the REST API, not an application per company | Enough to drive the demo in five minutes; a real deployment would give each company its own client |
| GitHub instead of GitLab | Matches what the team actually used |

## 3. How the system fits together

```
                    ┌──────────────────────────────┐
                    │   Demo scripts (terminal)    │
                    └──────────────┬───────────────┘
                                   │
                                   ▼
        ┌──────────┐  ┌──────────┐  ┌──────────┐   one backend per company,
        │ regulator│  │  farm    │  │ retailer │   each holding only its own
        │  :3001   │  │  :3002   │  │  :3005   │   key. Three of six shown.
        └────┬─────┘  └────┬─────┘  └────┬─────┘
             │             │             │
             └─────────────┼─────────────┘
                           │
                           ▼
        ┌──────────────────────────┐  ┌─────────────────────┐
        │   Blockchain (Fabric)    │  │ Databases (Postgres)│
        │  the shared record book  │  │ oracle: readings    │
        │  + the smart contracts   │  │ regulator: verdicts │
        └───────────▲──────────────┘  └──────────▲──────────┘
                    │                            │
                    │ summary + fingerprint      │ full readings
                    │                            │
              ┌─────┴────────────────────────────┴─────┐
              │        Temperature sensor feed         │
              │  reads readings, works out the stats,  │
              │  fingerprints them, sends them on      │
              └────────────────────────────────────────┘
```

In plain terms: the sensor feed produces temperature readings, each company's own backend talks to
the blockchain on its behalf, the full readings live in the database of the company that collected
them, and only a short summary plus a fingerprint go onto the blockchain where the smart contracts
check them.

## 4. What each part does

**The blockchain (Hyperledger Fabric).** A shared record book the companies keep together and
none of them can secretly change.

- Runs with six organisations, one per company, so no company's certificate authority can issue
  an identity for another and the regulator does not share one with those it regulates.
- A majority of the six must run a transaction and agree before it is written, and cold-chain
  evidence additionally requires the regulator's own peer to be among them.
- Every entry is signed by the company that made it, so who did what and when is always clear.

**Smart contract 1: Stakeholder.** Controls who is in the system and what they can do.

- The six roles are: regulator, farm, processor, logistics, retailer, and sensor.
- Only a regulator can add a company, change its role, or suspend it.
- Each company is tied to its own verified identity, so nobody can add themselves or pretend to
  be someone else.
- A suspended company is blocked from doing anything.
- The other contracts ask this one "is this caller allowed?" before they act.

**Smart contract 2: Batch lifecycle.** Runs the milk's journey.

- A batch moves in order: created, then processed, then in transit, then delivered.
- Each step can only be done by the right company: a farm creates it, a processor processes it,
  logistics transports it, a retailer takes delivery.
- Steps cannot be skipped or done out of order.
- A batch that has been recalled, or flagged for a temperature problem, cannot be delivered.
- Anyone authorised can pull up the full history of a batch.

**Smart contract 3: Temperature compliance.** Judges the cold chain.

- **The rule: milk must stay between 0°C and 5°C. Any reading outside that range is a breach.**
- When the sensor submits evidence, this contract applies the rule itself rather than trusting
  the sensor's word.
- If the milk got too warm, the contract flags the batch and raises an alert, and the batch
  cannot be delivered until a regulator clears it.
- Only the registered sensor is allowed to submit evidence.

**The sensor feed (oracle) and off-chain computation.** Stands in for the temperature loggers
on a truck.

- Reads a batch of readings and works out the minimum, maximum and average.
- Produces a fingerprint of the exact readings.
- Saves the full readings in the database, and sends only the summary and the fingerprint to the
  blockchain.
- If a reading were later changed, the fingerprint would no longer match, which is how tampering
  is caught.

**The databases (PostgreSQL).** Hold the bulky data that does not belong on a shared ledger. There
are two, because six competing companies sharing one would defeat the point of having a ledger.

- The oracle's holds the full temperature readings it collected.
- The regulator's holds an archive of the verdicts the contract reached, built from the chain's
  own events. It never copies the oracle's opinion of the same readings, so the two can be
  compared.
- The other four companies store nothing off-chain.
- Only the short summary and the fingerprint live on the blockchain.

**The backends (one per company).** Each company's own front desk.

- Loads exactly one certificate at startup and talks to exactly one peer.
- Cannot act as any other company, because it holds no other company's key.
- The regulator's listens for temperature alerts and builds the archive; the others do not.
- The retailer's filters what the public is allowed to see, for a shopper holding no identity.

**How one company checks another.** Verification needs readings and an anchor, and it deliberately
gets them from different places. Any company can ask the oracle for the readings over HTTP,
recompute the fingerprint itself, and compare that against the anchor it reads off the ledger with
its own certificate. A retailer can therefore catch its supplier altering records, which a company
auditing its own database never could.

That endpoint is worth being precise about. The oracle's backend reads the ledger before serving
readings, but it signs that read with the oracle's certificate, because that is the only one it
holds. So the check answers "is the oracle registered and does this evidence exist", and nothing
about the caller. **The readings endpoint is unauthenticated with respect to who is asking.** The
evidence ID contains part of the hash so it is not enumerable, but that is obscurity, not access
control.

The verification is sound regardless. A dishonest oracle cannot make altered readings verify: the
fingerprint it is checked against came off the ledger, not from the oracle. The most it can do is
refuse to answer or answer with rubbish, and both surface as a mismatch or an error rather than as
a clean result. Fixing the endpoint properly means a Fabric-signed request the oracle can verify,
or private data collections so the readings never leave the peers entitled to them.

## 5. What the demo shows

- **A batch that arrives safely.** Companies are added, a batch is created and moves all the way
  to delivery, a compliant temperature check passes, and the full history is shown.
- **A batch that gets too warm.** An unsafe temperature check is submitted, the contract flags the
  batch and blocks delivery, and the regulator recalls it.
- **Tampering is caught.** The database readings are checked against the blockchain fingerprint and
  they match. One reading is then changed, the fingerprints no longer match, and the record on the
  blockchain is shown to be unchanged.
- **An unauthorised action is refused.** A logistics company tries to create a batch and the
  contract rejects it.

## 6. How it meets the requirements

Task 3 asks for five things, and each maps to a part above:

- Interacts with a blockchain → each company's backend and the sensor feed talk to Fabric.
- At least two smart contracts with real logic → two packages holding three contracts, each one
  making decisions and refusing invalid actions.
- Off-chain computation → the sensor feed working out the stats and the fingerprint.
- Off-chain storage → the two Postgres databases, one per company that keeps records.
- An oracle → the temperature sensor feed.

The Task 2 quality goals are shown by the demo: integrity (tampering is caught), fast
traceability (full history in seconds), and non-repudiation (every entry is tied to who
submitted it and when).