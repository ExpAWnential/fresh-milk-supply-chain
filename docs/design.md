# Fresh Milk Cold-Chain PoC — Task 3 Design

**Date:** 2026-07-14
**Status:** Approved design, ready for implementation planning

## 1. Purpose

A blockchain-based proof of concept for fresh-milk cold-chain traceability, implementing
Architecture B from Task 2 (permissioned Hyperledger Fabric with off-chain storage).

The PoC demonstrates one reliable end-to-end scenario rather than a production platform:
a regulator onboards stakeholders, a farm creates a milk batch, authorised parties record
its movement, an oracle processes sensor readings, raw readings are stored off-chain,
evidence summaries and hashes are anchored on-chain, and the smart contracts decide whether
the batch may proceed.

## 2. Changes from Task 2 (for the "changes due to feedback" slide)

| Change | Reason |
|---|---|
| NFRs made measurable | Task 2 feedback |
| Explicit on-chain / off-chain data split defined | Task 2 feedback |
| Oracle component added | Task 3 requirement, and cold-chain evidence needs a trusted feed |
| Role and lifecycle enforcement moved *into* the contracts | Contracts must hold business logic, not just data |
| Consumers removed from the blockchain network | Consumers get a filtered public REST endpoint instead. A permissioned channel does not give per-field confidentiality, so channel membership is not a good consumer access mechanism |
| Two chaincode packages, three contract classes | Removes any ambiguity about "at least two smart contracts" |
| CouchDB enabled as the Fabric state database | Required for rich queries backing the 10-second traceability NFR |
| No GUI | REST API plus scripted terminal demo. The brief permits this where inter-component communication is clearly shown |
| GitHub instead of GitLab | Matches what the team actually used |

## 3. Component architecture

```
                    ┌──────────────────────────────┐
                    │  CLI demo scripts / curl     │
                    └──────────────┬───────────────┘
                                   │ REST
                                   ▼
                    ┌──────────────────────────────┐
                    │   Node.js / Express backend  │
                    │  - selects Fabric identity   │
                    │  - validates input           │
                    │  - filters public responses  │
                    │  - listens for chaincode     │
                    │    events (breach alerts)    │
                    └──────┬────────────────┬──────┘
                  Fabric   │                │  SQL
                  Gateway  │                │
                           ▼                ▼
        ┌──────────────────────────┐  ┌─────────────────────┐
        │  Hyperledger Fabric      │  │ PostgreSQL (Docker) │
        │  milkchannel, CouchDB    │  │                     │
        │                          │  │ - raw readings      │
        │  chaincode: stakeholder  │  │ - evidence records  │
        │    StakeholderRegistry   │  │ - documents         │
        │                          │  │ - fabric tx ids     │
        │  chaincode: supplychain  │  │                     │
        │    BatchLifecycle        │  │                     │
        │    TemperatureCompliance │  │                     │
        └───────────▲──────────────┘  └──────────▲──────────┘
                    │                            │
                    │ signed tx (oracle identity)│ raw readings
                    │                            │
              ┌─────┴────────────────────────────┴─────┐
              │        Temperature Oracle service      │
              │  - reads simulated IoT sensor CSV      │
              │  - validates and canonicalises         │
              │  - computes min/max/mean/violations    │
              │  - computes SHA-256 of canonical form  │
              │  - persists raw readings to Postgres   │
              │  - submits evidence summary on-chain   │
              └────────────────────────────────────────┘
```

**Requirement mapping:**

- Interacts with a blockchain → Fabric Gateway from backend and oracle
- Two smart contracts → two chaincode packages (`stakeholder`, `supplychain`)
- Off-chain computation → oracle statistics, canonicalisation and hashing
- Off-chain storage → PostgreSQL
- Oracle → temperature oracle service

## 4. Fabric network

Two organisations on the standard `test-network`, one channel, CouchDB state database.

- **RegulatorOrg** — onboards and suspends stakeholders, initiates recalls, views all evidence.
- **SupplyChainOrg** — holds identities for farm, processor, logistics, retailer and oracle.

Roles are not Fabric organisations. Each Fabric X.509 identity is bound to a stakeholder
record carrying its role, held in the stakeholder registry contract. This gives genuine
authenticated identities without needing five organisations.

Channel: `milkchannel`. Start with `./network.sh up -s couchdb` from day one, because
switching the state database later means tearing the network down.

## 5. Smart contracts

### Chaincode package `stakeholder` — StakeholderRegistryContract (FR1)

Transactions: `RegisterStakeholder`, `GetStakeholder`, `UpdateStakeholderRole`,
`SuspendStakeholder`, `ReactivateStakeholder`, `AssertActiveRole`.

Business logic:

- Only a REGULATOR identity may register, update or suspend a stakeholder.
- The caller's identity is read from its X.509 certificate, so nobody can self-register.
- One certificate maps to at most one active stakeholder.
- Duplicate stakeholder IDs rejected. Only known roles accepted.
- Suspended stakeholders cannot submit any supply-chain transaction.
- Role changes record the acting regulator and the Fabric transaction timestamp.

Roles: `REGULATOR`, `FARM`, `PROCESSOR`, `LOGISTICS`, `RETAILER`, `ORACLE`.

### Chaincode package `supplychain`

Both contracts below call into the `stakeholder` chaincode via `invokeChaincode` to check
role and active status before every write. This cross-chaincode call is what makes the two
contracts cooperate rather than sit side by side.

**BatchLifecycleContract (FR2)**

Transactions: `CreateBatch`, `RecordProcessingEvent`, `StartTransport`, `RecordDelivery`,
`RecallBatch`, `GetBatch`, `GetBatchHistory`, `QueryBatchesByStatus`.

Lifecycle: `CREATED → PROCESSED → IN_TRANSIT → DELIVERED → COMPLETED`, with
`COLD_CHAIN_BREACH` and `RECALLED` as exceptional states.

Business logic:

- Only FARM or PROCESSOR may create a batch. Only PROCESSOR may record processing.
  Only LOGISTICS may start transport. Only RETAILER may record delivery.
- Out-of-order transitions rejected against an explicit transition map.
- A recalled batch cannot be transported or delivered.
- A batch with an unresolved cold-chain breach cannot be delivered.
- Duplicate event IDs rejected.
- Every event records the invoking certificate identity, Fabric transaction ID and
  Fabric transaction timestamp. Client-supplied timestamps are never trusted.
- `GetBatchHistory` uses Fabric's native `GetHistoryForKey` for the full audit trail.

**TemperatureComplianceContract (FR3)**

Transactions: `SubmitTemperatureEvidence`, `GetTemperatureEvidence`,
`VerifyEvidenceReference`, `ResolveTemperatureBreach`.

Business logic:

- Only the registered ORACLE identity may submit evidence.
- Evidence must reference an existing batch currently in transport or storage.
- Duplicate evidence IDs rejected.
- **The contract re-applies the cold-chain rule itself rather than trusting the oracle's
  verdict.** PoC rule: min ≥ 0 °C, max ≤ 5 °C, violation count = 0.
- Unsafe evidence automatically sets the batch to `COLD_CHAIN_BREACH` and emits a
  `ColdChainBreach` chaincode event.
- Delivery stays blocked until the breach is resolved or the batch is recalled.
- An evidence hash, once written, cannot be replaced.

On-chain evidence record:

```json
{
  "evidenceId": "TEMP-TRIP-001",
  "batchId": "MILK-001",
  "offChainRecordId": "db-temp-001",
  "sha256": "74a8...",
  "minimumTemperature": 2.1,
  "maximumTemperature": 4.7,
  "averageTemperature": 3.4,
  "violationCount": 0,
  "compliant": true,
  "oracleId": "ORACLE-01"
}
```

The individual readings are never placed on-chain.

### Chaincode determinism constraint

Every endorsing peer executes the contract independently and the read/write sets must match
byte for byte. Chaincode must therefore contain no `Date.now()`, no `Math.random()`, and no
iteration over unordered structures. Use `ctx.stub.getTxTimestamp()` for time.

## 6. Oracle and off-chain computation

A standalone Node.js service, separate from the backend.

Input, a simulated IoT sensor file:

```
timestamp,deviceId,batchId,temperature
2026-07-20T09:00:00Z,SENSOR-01,MILK-001,3.2
2026-07-20T09:05:00Z,SENSOR-01,MILK-001,3.5
```

Process:

1. Read the CSV and validate that every reading shares one batch and one sensor.
2. Sort readings by timestamp.
3. Canonicalise into a deterministic string form: fixed field order, fixed decimal
   precision, fixed row order, fixed line terminator. Without this, identical data can
   produce different hashes and verification breaks.
4. Compute minimum, maximum, average, violation count, first and last reading times.
5. Persist the full reading set to PostgreSQL.
6. Compute `SHA-256(canonical form)`.
7. Submit the hash and summary to Fabric under the oracle's identity.
8. Store the returned Fabric transaction ID against the database record.

If the Fabric submission fails, the database record is marked `PENDING` rather than
reported as submitted.

## 7. Off-chain storage

PostgreSQL, running in Docker beside the Fabric containers. Chosen over SQLite because it
is genuinely a shared database as the brief describes, and over IPFS because a
content-addressed CID published on the shared ledger would let any channel member fetch the
raw readings, which conflicts with the confidentiality NFR.

Tables:

- `temperature_evidence` — id, batch_id, device_id, sha256, min/max/avg temperature,
  violation_count, fabric_transaction_id, status, created_at
- `temperature_readings` — id, evidence_id, recorded_at, temperature
- `documents` — id, batch_id, document_type, file_location, sha256, created_at

No passwords, certificates or private keys in the database.

## 8. Backend API

Express, using `@hyperledger/fabric-gateway`.

- `POST /stakeholders`, `PATCH /stakeholders/:id/status`, `GET /stakeholders/:id`
- `POST /batches`, `POST /batches/:id/events`, `POST /batches/:id/recall`,
  `GET /batches/:id`, `GET /batches/:id/history`
- `POST /oracle/evidence`, `GET /batches/:id/temperature`, `GET /evidence/:id/verify`
- `GET /public/batches/:id` — filtered consumer view, no blockchain membership required

Identity selection for the PoC uses a controlled `X-Demo-Identity` header mapping to a
Fabric wallet identity. This is explicitly a PoC mechanism and is documented as such, not
presented as production authentication.

The backend also subscribes to chaincode events and surfaces `ColdChainBreach` alerts.

## 9. Demonstration workflows

**A. Compliant delivery.** Regulator onboards all parties. Farm creates MILK-001.
Processor processes. Logistics starts transport. Oracle ingests a compliant reading file,
stores raw readings in Postgres, submits hash and summary. Contract marks evidence
compliant. Retailer records delivery. Full history queried.

**B. Unsafe temperature.** Oracle processes a file containing unsafe readings. Contract
sets `COLD_CHAIN_BREACH` and emits the breach event. Retailer's delivery attempt is
rejected by the contract. Regulator recalls the batch.

**C. Evidence tampering.** Verify that the Postgres hash matches the on-chain hash
(`MATCH`). A script modifies one off-chain reading. Recompute. Verification returns
`HASH MISMATCH`. The on-chain evidence is unchanged.

**D. Unauthorised action.** A logistics identity attempts to create a batch. The contract
rejects it: `Access denied: role LOGISTICS cannot create a batch`.

## 10. Testing

- Chaincode unit tests with a mocked `ChaincodeStub` (Mocha, Chai, Sinon), covering every
  rejection path: unauthorised role, illegal transition, duplicate ID, breached batch
  delivery, suspended stakeholder.
- Oracle unit tests for canonicalisation determinism and statistics.
- Integration tests against the running network covering workflows A to D.
- Performance check: 100 batches, traceability query under 10 seconds.

## 11. Patterns used (name these on the implementation slide)

Off-Chain Data Storage, Hash Anchoring, Oracle, Embedded Permission (RBAC), Asset Lifecycle
state machine, Event emission for off-chain listeners, Cross-chaincode delegated
authorisation, Repository pattern in the backend.

## 12. Acceptance checklist

- [ ] Regulator can onboard stakeholders; non-regulator onboarding is rejected
- [ ] Farm can create a batch; logistics cannot
- [ ] Batch events must follow the valid order
- [ ] Only the oracle can submit temperature evidence
- [ ] Raw readings present in Postgres, absent from the ledger
- [ ] Hash and summary appear on-chain
- [ ] Safe evidence permits delivery; unsafe evidence blocks it
- [ ] Regulator can recall a batch
- [ ] Modified off-chain evidence fails verification
- [ ] Batch history includes submitter identity, timestamp and transaction ID
- [ ] Traceability query over 100 batches completes within ~10 seconds
- [ ] `npm test` passes
- [ ] A new team member can follow the README and run the demo

## 13. Repository structure

```
fresh-milk-supply-chain/
├── README.md
├── docs/            architecture, requirements mapping, contribution log, slides
├── network/         start/stop/reset/deploy scripts, docker compose (Postgres)
├── chaincode/
│   ├── stakeholder/     StakeholderRegistryContract + tests
│   └── supplychain/     BatchLifecycle + TemperatureCompliance + tests
├── applications/
│   ├── api/         Express backend + tests
│   └── oracle/      temperature oracle + tests
├── storage/         schema.sql, migrations
├── data/            compliant-readings.csv, unsafe-readings.csv
├── scripts/         enrol-identities, seed-demo, run-demo, tamper-evidence
└── tests/integration/
```

## 14. Team allocation

| Member | Task 3 contribution |
|---|---|
| Alex | Backend integration, requirements mapping, demo coordination, presentation |
| Garry | Temperature oracle, compliance calculation, sensor test datasets |
| Cavan | Stakeholder registry contract, identity-role enforcement, contract tests |
| Zhelian | Batch lifecycle contract, Fabric network setup, revised architecture diagram |
| Ray | Postgres storage, evidence verification endpoint, tampering demo |

Everyone reviews at least one other member's pull request, giving evidence of collaboration
rather than five isolated components.

## 15. Known risks

- Fabric CA identity enrolment is the largest hidden time sink. Do it in sprint 1, early.
- Cross-chaincode invocation requires both chaincodes committed to the same channel.
- The network must be running before the presentation. Do not start or deploy it live.
