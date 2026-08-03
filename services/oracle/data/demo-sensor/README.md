# The demo sensor's keys

These stand in for a temperature logger. A real cold-chain sensor holds a private key and signs each
reading as it measures it; `src/signReadings.ts` does the same thing to the sample CSVs so the rest
of the system can be built and demonstrated against genuinely signed data.

`SENSOR-001` signs `compliant-readings.csv`, `SENSOR-002` signs `unsafe-readings.csv`.

## Why the private key is committed

Deliberately, and it is the opposite of what a real deployment would do.

The signed CSVs in `../` are part of the repository. If everyone generated their own key, those
signatures would verify only on the machine that produced them and the demo would look broken
everywhere else. So the key ships with the readings it signed.

The root `.gitignore` ignores `*.key` everywhere; this directory is the single documented exception.

Nothing real is protected by this key. It signs three rows of invented temperatures. No identity,
certificate or ledger permission depends on it — those come from the Fabric MSPs under
`fabric/milk-network/organizations/`, which are not committed.

## What it demonstrates, and what it does not

The oracle never holds this private key. It only ever reads `SENSOR-001.pub`, and the public key it
verifies against comes from the ledger, where the regulator registered it. So the oracle genuinely
cannot forge a reading: it can alter a number, but it cannot produce a signature that fits.

What this does not do is remove trust. It moves it from the oracle to whoever holds the sensor key —
which is what security always does. In a real deployment that key would be generated inside the
device and never leave it.

## Regenerating

```
pnpm --filter @fresh-milk/oracle sensor:keygen
pnpm --filter @fresh-milk/oracle sensor:sign data/compliant-readings.csv
pnpm --filter @fresh-milk/oracle sensor:sign data/unsafe-readings.csv
```

Sign the unsigned originals, not an already-signed file — the script refuses the latter, because a
signature covering a signature is meaningless. `compliant-readings-unsigned.csv` is kept for that,
and for the test that the oracle refuses unsigned data.

The new public key then has to be registered on the ledger again, as the regulator.
