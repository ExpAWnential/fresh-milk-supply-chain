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
| No graphical interface | A REST interface and a scripted terminal demo are enough, and the brief allows this |
| GitHub instead of GitLab | Matches what the team actually used |

## 3. How the system fits together

```
                    ┌──────────────────────────────┐
                    │   Demo scripts (terminal)    │
                    └──────────────┬───────────────┘
                                   │
                                   ▼
                    ┌──────────────────────────────┐
                    │        Backend (front desk)  │
                    │  ties everything together    │
                    └──────┬────────────────┬──────┘
                           │                │
                           ▼                ▼
        ┌──────────────────────────┐  ┌─────────────────────┐
        │   Blockchain (Fabric)    │  │  Database (Postgres) │
        │  the shared record book  │  │  full readings and   │
        │  + the smart contracts   │  │  documents           │
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

In plain terms: the sensor feed produces temperature readings, the backend ties the parts
together, the full readings live in the database, and only a short summary plus a fingerprint
go onto the blockchain where the smart contracts check them.

## 4. What each part does

**The blockchain (Hyperledger Fabric).** A shared record book that the companies keep
together and none of them can secretly change. It runs with two organisations: a regulator
side and a supply-chain side that holds the farm, processor, logistics, retailer and sensor
identities. Each company signs its own entries, so it is always clear who did what and when.

**Smart contract 1 — Stakeholder.** Controls who is in the system and what they are allowed
to do. Only a regulator can add, change the role of, or suspend a company. Each company is
tied to its own verified identity, so nobody can add themselves or pretend to be someone else.
A suspended company is blocked from doing anything. The other contracts ask this one "is this
caller allowed?" before they act.

**Smart contract 2 — Batch lifecycle.** Runs the milk's journey. A batch is created by a farm
or processor, then moves through processing, transport and delivery. Each step can only be done
by the right kind of company, and steps cannot be skipped or done out of order. A batch that has
been recalled, or flagged for a temperature problem, cannot be delivered. Anyone authorised can
pull up the full history of a batch.

**Smart contract 3 — Temperature compliance.** Judges the cold chain. When the sensor feed
submits temperature evidence, this contract decides for itself whether the milk got too warm,
rather than trusting the sensor's word. If it did, the contract flags the batch and raises an
alert, and the batch cannot be delivered until a regulator clears it. Only the registered sensor
is allowed to submit evidence.

**The sensor feed (oracle) and off-chain computation.** A separate program that stands in for
the temperature loggers on a truck. It reads a batch of readings, works out the minimum, maximum
and average, and produces a fingerprint of the exact readings. It saves the full readings in the
database and sends only the summary and the fingerprint to the blockchain. If a reading were
later changed, the fingerprint would no longer match, which is how tampering is caught.

**The database (PostgreSQL).** Holds the bulky and sensitive data that does not belong on a
shared ledger: the full temperature readings and supporting documents. Access is controlled
through the backend. Only the short summary and the fingerprint live on the blockchain.

**The backend (front desk).** Ties the three parts together. It takes requests, acts as the
right company's identity, talks to both the blockchain and the database, filters what the public
is allowed to see, and listens for temperature alerts.

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

- Interacts with a blockchain → the backend and sensor feed talk to Fabric.
- At least two smart contracts with real logic → two packages holding three contracts, each one
  making decisions and refusing invalid actions.
- Off-chain computation → the sensor feed working out the stats and the fingerprint.
- Off-chain storage → the Postgres database.
- An oracle → the temperature sensor feed.

The Task 2 quality goals are shown by the demo: integrity (tampering is caught), fast
traceability (full history in seconds), and non-repudiation (every entry is tied to who
submitted it and when).

## 7. Design patterns used (name these in the presentation)

Off-chain storage, fingerprint anchoring, oracle, role-based access control, a state machine for
the batch journey, event alerts, one contract delegating checks to another, and the repository
pattern in the database layer.

## 8. What "done" looks like

- A regulator can add companies, and a non-regulator cannot.
- A farm can create a batch, and a logistics company cannot.
- Batch steps must happen in the correct order.
- Only the sensor feed can submit temperature evidence.
- Full readings are in the database and not on the blockchain.
- A safe check allows delivery, an unsafe one blocks it.
- A regulator can recall a batch.
- Changed readings fail the fingerprint check.
- History shows who submitted each entry and when.
- The tests pass, and a new team member can follow the setup and run the demo.

## 9. Known limitations to be upfront about

- For the demo the backend holds every company's identity and picks which one to act as. In a real
  system each company would sign for itself. This is a proof-of-concept shortcut and is stated as
  such.
- Everything runs on Fabric's local test network on one laptop, which is the standard way to build
  a proof of concept, not a production setup.
- The blockchain must be running before the presentation. It should not be started live.
