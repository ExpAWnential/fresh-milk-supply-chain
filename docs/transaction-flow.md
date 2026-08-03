# How a Transaction Flows

What happens between someone submitting a request and the ledger being updated.

## The words

**Organisation.** A company that participates in the network. There are six organisations, one for
each party: the regulator, farm, processor, logistics operator, retailer and sensor operator behind
the oracle.

**Certificate.** A digital identity that proves a user belongs to a particular organisation. It is
paired with a **private key**, which is kept secret and used to sign requests. The certificate
accompanies each request so that the network can verify the user's identity. The private key never
leaves the machine that owns it.

**Role.** A business identity such as `FARM` or `RETAILER`. Fabric does not recognise these roles.
They exist only in the stakeholder registry, which maps each certificate to a role. Because every
company has its own organisation, the two correspond closely, but they remain separate concepts.
Fabric enforces organisation membership, while the registry enforces business roles.

**Client.** The software a company uses to interact with the network. In this project, it is the
Express backend. The client holds certificates and submits proposals, but it does not hold a copy of
the ledger. Each company runs its own client, which holds only that company's private key.

**Peer.** A server that belongs to an organisation. It holds a full copy of the ledger and runs the
chaincode. Each organisation has one peer.

**Ledger.** The data maintained by every peer. It has two parts. The **blockchain** is the ordered,
immutable history of every transaction. The **world state** contains the current value of every
record for fast lookup. Reading a record uses the world state, while reading its history traverses
the blockchain.

**Chaincode and contract.** Chaincode is a deployable package installed on the peers. A contract is
a class within that package. This project has two chaincode packages containing three contracts.

**Orderer.** A server that establishes the order of transactions and groups them into blocks.

**Channel.** A private ledger shared by a specific group of organisations. This project's channel is
`milkchannel`. Organisations outside the channel cannot see its data.

## What each peer holds

```
regulator   farm   processor   logistics   retailer   sensor operator
    │        │         │           │           │            │
    ▼        ▼         ▼           ▼           ▼            ▼
  peer     peer      peer        peer        peer         peer
    ├ full blockchain copy
    ├ world state
    └ both chaincodes
```

The six peers maintain their own copies of the same channel ledger. No organisation has to rely on
another organisation to store it.

## Who calls

Each company runs its own client, holding only its own certificate and private key. The farm's
software cannot sign as the retailer.

The client does not restrict which functions each role may call. Any user may attempt to call any
function, but the contract rejects calls that are not authorised. This is why the access rules live
in the chaincode rather than in the client.

## The four phases

Consider what happens when the retailer marks a batch as delivered.

**1. Propose.** The client signs a request to run `recordDelivery` for a batch and sends it to the
peers. At this stage, the request is a proposal rather than a transaction.

**2. Endorse.** The required peers independently simulate the proposal.

```
              one proposal
                   │
      ┌────────────┼────────────┐
      ▼            ▼            ▼
   a peer       a peer       a peer      ... enough to satisfy the policy
 runs the code  runs the code  runs the code
 signs "X"      signs "X"      signs "X"
```

Each peer runs the contract without updating the ledger, then signs the result it would write. This
signature is its endorsement. If the contract returns an error, the peer does not endorse the
proposal.

The Fabric Gateway collects enough endorsements to satisfy the policy and checks that the peers
produced the same result. It then combines the endorsements with the original proposal. If the
results differ or there are too few endorsements, the transaction cannot be submitted and the
caller receives an error.

**3. Order.** Once the endorsements are attached, the proposal becomes a transaction. The ordering
service places it in sequence with other transactions and groups it into a block for distribution
to the peers.

**4. Validate and commit.** After receiving the ordered block, every peer independently verifies
that the submitted transaction satisfies the endorsement policy. It also checks whether any data
read during endorsement has since changed. If both checks pass, the peer applies the writes to its
world state. Otherwise, it records the transaction as invalid and discards the writes.

Committed chaincode events become available after this phase, so receiving one confirms that its
transaction was committed.

## What a rejection leaves behind

A proposal rejected during endorsement leaves no record on the ledger. A transaction rejected
during validation remains in the block but is marked invalid, and its writes are discarded.

## Reads skip all of this

A read request is evaluated by one peer and returned without collecting endorsements or sending a
transaction to the ordering service. It does not create a block or change the ledger, so it is
usually much faster than a write.

## The endorsement policy

The `stakeholder` chaincode uses the channel's default majority policy, which requires four of the
six organisations. The `supplychain` chaincode also requires four endorsements, but the regulator
must be one of them.
