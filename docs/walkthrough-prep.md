# Code Walkthrough Prep

What to study, in what order, and what to be able to say about each file. The codebase is about
4,300 lines of source, but only around 1,500 need to be known cold.

## Tier 1: know these properly

Roughly 1,400 lines. These are what questions will be about.

| File | Lines | Be able to say |
|---|---|---|
| `fabric/chaincode/stakeholder/src/contracts/StakeholderRegistryContract.ts` | 443 | The six roles, regulator-only writes, the bootstrap problem, the active-regulator counter, and `assertActiveRole` |
| `fabric/chaincode/supplychain/src/contracts/BatchLifecycleContract.ts` | 308 | The state machine, the two locks in `transitionBatch`, and why history comes free |
| `fabric/chaincode/supplychain/src/contracts/TemperatureComplianceContract.ts` | 259 | The 0-5°C rule, and why the contract re-derives the verdict instead of trusting the oracle |
| `fabric/chaincode/supplychain/src/utils/stakeholderClient.ts` | 106 | How one chaincode calls another to check permissions |
| `services/storage/src/evidenceHash.ts` | 89 | Canonicalise then SHA-256, and why the ordering rule matters |
| `services/oracle/src/runOracle.ts` | 147 | The run end to end, why the row is saved PENDING first, and the failure handling |
| `services/backend/src/services/evidenceVerification.ts` | 169 | Three hashes, and why the anchor has to come off the ledger |
| `services/storage/initdb/01-oracle.sql` | 43 | The oracle's two tables, and the constraint that makes ANCHORED without a transaction ID impossible |
| `services/storage/initdb/02-regulator.sql` | 29 | A separate database for the regulator's archive, and why it references nothing of the oracle's |
| `services/backend/src/services/readingsSource.ts` | 79 | Local versus fetched readings, and why an unreachable holder must raise rather than read as absent |

## Tier 2: understand, do not memorise

About 500 lines.

| File | Why it matters |
|---|---|
| `fabric/chaincode/*/src/utils/identity.ts` and `txContext.ts` | 30 lines each. Where every trusted value comes from. Small but foundational |
| `services/backend/src/events/complianceEvents.ts` | How the ledger's verdict gets back into PostgreSQL |
| `services/backend/src/organisations.ts` | The six companies, and how a process learns which one it is |
| `fabric/chaincode/supplychain/src/models/Batch.ts` and `TemperatureEvidence.ts` | What is actually stored. 80 lines total, quick to absorb |
| `services/storage/src/tamperEvidence.ts` | The demo that gets run live |

## Tier 3: know they exist

`services/backend/src/fabric/gateway.ts` (gRPC plumbing), `services/backend/src/routes/*` (thin
HTTP wrappers), `fabric/network/*` (setup scripts), `config.ts`, `pool.ts`.

"That is the Fabric connection layer" is a sufficient answer. Nobody is marking gRPC deadlines.

## Reading order

Follow the story rather than the folder structure. Each file hands off to the next.

```
1. identity.ts + txContext.ts      what "who is calling" actually means
2. StakeholderRegistryContract     who is allowed to do what
3. BatchLifecycleContract          the milk's journey
4. evidenceHash.ts                 the fingerprint
5. runOracle.ts                    one oracle run
6. TemperatureComplianceContract   the verdict
7. evidenceVerification.ts         catching tampering
8. complianceEvents.ts             the verdict coming back off the chain
```

## Likely questions and where the answer lives

| Question | Answer |
|---|---|
| Where is the off-chain computation? | `runOracle.ts` and `evidenceHash.ts` |
| How do you know the database was not edited? | `evidenceVerification.ts`, three hashes compared |
| Why trust the oracle? | You do not. `TemperatureComplianceContract` derives the verdict itself |
| What stops a logistics company creating a batch? | `assertActiveRole`, and a test proves the rejection |
| Why two chaincodes? | Different systems with different owners, hence the cross-chaincode call |
| What if the oracle lies? | Three lies, three defences. It cannot assert a verdict, since it only sends statistics and the contract decides. It cannot anchor a flattering summary, because verification recomputes the statistics from the readings. And it cannot invent a reading, because the sensor signs each one and the oracle holds no sensor key. What it still cannot be stopped from doing is dropping readings off the end of a run |
| Who checks the signatures? | Anyone but the oracle, which is the point. Verification needs only the public key, so the sensor alone can sign and any registered company can check. The regulator does it automatically on every evidence event, within seconds; the verify route on all six backends does it on demand. A check the oracle ran on itself would prove nothing, because it could simply not run it |
| Does the chain refuse a forged reading? | No, and say so plainly. A peer would need the readings to check a signature, and anything sent to a peer stays in a block forever, which defeats off-chain storage. Private data collections are Fabric's answer, but they are for confidential business data rather than bulk telemetry. This is detection, not prevention |
| You generated the sensor key yourselves | So is every certificate on this network, by cryptogen. It relocates trust to the key holder rather than removing it, which is what security always does. The oracle process genuinely cannot forge a signature for a key it does not hold |
| At what stage can temperature evidence be submitted? | Any stage except a recalled batch, because milk has to stay cold from the farm's tank to the retailer's fridge. A breach records the stage it interrupted in `statusBeforeBreach`, so clearing it returns the batch there rather than assuming transport |

## Before the walkthrough

Run `pnpm test` and `pnpm typecheck`. Both should be clean.

The demo itself is driven from the control panel at <http://localhost:3001>, with the oracle and the
tamper command run in a terminal beside it. Those two stay outside the page on purpose: the oracle is
a separate off-chain process, and tampering means reaching into PostgreSQL around the application, so
a button inside the application would misrepresent both.
