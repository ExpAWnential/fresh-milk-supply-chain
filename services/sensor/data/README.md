# The demo sensor's keys

These stand in for a temperature logger. A real cold-chain sensor holds a private key and signs each
reading as it measures it; `../src/signReadings.ts` does the same thing to the sample CSVs so the
rest of the system can be built and demonstrated against genuinely signed data.

`SENSOR-001` signs `compliant-readings.csv`, `SENSOR-002` signs `unsafe-readings.csv`. Both live in
`services/oracle/data/`, because they are the oracle's input: it receives a signed file it did not
produce.

## Why the private key is committed

Deliberately, and it is the opposite of what a real deployment would do.

The signed CSVs are part of the repository. If everyone generated their own key, those signatures
would verify only on the machine that produced them and the demo would look broken everywhere else.
So the key ships with the readings it signed.

The root `.gitignore` ignores `*.key` everywhere; this directory is the single documented exception.

Nothing real is protected by this key. It signs three rows of invented temperatures. No identity,
certificate or ledger permission depends on it — those come from the Fabric MSPs under
`fabric/milk-network/organizations/`, which are not committed.

## What it demonstrates, and what it does not

The sensor is a separate package precisely so the oracle cannot reach this key. Nothing under
`services/oracle/` reads it, and the oracle has no signing code at all: it can alter a number, but it
has no way to produce a signature that fits. The public key it verifies against comes from the
ledger, where the regulator registered it, not from this directory.

What this does not do is remove trust. It moves it from the oracle to whoever holds the sensor key,
which is what security always does. In a real deployment the key would be generated inside the device
during certification and never leave it, and the regulator would attest to the sealed device rather
than to a file someone handed it.

The separation here is one of code, not of hardware. Whoever runs the demo has both directories.

## Regenerating

```
pnpm sensor:keygen
pnpm sensor:sign ../oracle/data/compliant-readings.csv
pnpm sensor:sign ../oracle/data/unsafe-readings.csv
```

Sign the unsigned originals, not an already-signed file — the script refuses the latter, because a
signature covering a signature is meaningless. `compliant-readings-unsigned.csv` is kept for that,
and for the test that the oracle refuses unsigned data.

The new public key then has to be registered on the ledger again, as the regulator.
