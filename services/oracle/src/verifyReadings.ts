/**
 * Checks that every reading really came from the sensor it claims to, before the oracle commits to
 * it in any way.
 *
 * This runs inside the oracle, which is the party it constrains, so on its own it proves nothing to
 * anyone else: a dishonest oracle would simply not run it. Its job is to fail fast on a broken or
 * altered feed, and to make an honest oracle's refusal visible immediately rather than hours later
 * when somebody happens to verify. The check that actually binds the oracle is the same one done
 * again by another company, against signatures stored alongside the readings.
 *
 * The public key comes from the ledger, where the regulator put it. Reading it from the file beside
 * the readings would mean checking the oracle's data against the oracle's own copy of the key.
 */
import { sensorPublicKey, verifyReadingSignature } from "@fresh-milk/storage";
import type { CanonicalTemperatureReading } from "./canonicalise.js";

// Only what a check actually needs. The ledger record carries more, but a field nothing reads is a
// field that can quietly stop being populated without anything noticing.
export interface SensorPublicKey {
  readonly publicKey: string;
  readonly active: boolean;
}

// Returns undefined only when the ledger positively holds no key. Anything else has to throw, so
// that an unreachable peer can never be mistaken for an unregistered sensor.
export type SensorKeyLookup = (sensorId: string) => Promise<SensorPublicKey | undefined>;

export class ReadingsRejected extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ReadingsRejected";
  }
}

export async function verifyReadings(
  readings: readonly CanonicalTemperatureReading[],
  lookup: SensorKeyLookup
): Promise<void> {
  if (readings.length === 0) {
    throw new ReadingsRejected("There are no readings to verify.");
  }

  // One sensor per run. The evidence record names a single sensor and the sequence numbers are
  // only contiguous within one device's run, so a mixed file would be checked against the wrong
  // key and the wrong sequence at once.
  const sensorIds = [...new Set(readings.map((reading) => reading.sensorId))];
  if (sensorIds.length > 1) {
    throw new ReadingsRejected(
      `Readings must all come from one sensor, found: ${sensorIds.join(", ")}.`
    );
  }

  const sensorId = sensorIds[0];
  const sensorKey = await lookup(sensorId);
  if (!sensorKey) {
    throw new ReadingsRejected(
      `Sensor '${sensorId}' has no key registered on the ledger, so its readings cannot be ` +
        `checked. A regulator must register it first.`
    );
  }
  if (!sensorKey.active) {
    throw new ReadingsRejected(
      `Sensor '${sensorId}' has had its key revoked, so its readings are no longer accepted.`
    );
  }

  assertContiguousSequence(readings, sensorId);

  // Parsed once for the whole run rather than per reading.
  const publicKey = sensorPublicKey(sensorKey.publicKey);

  for (const reading of readings) {
    if (!verifyReadingSignature(reading, reading.signature, publicKey)) {
      throw new ReadingsRejected(
        `Reading ${reading.sequence} of sensor '${sensorId}' does not match its signature, so it ` +
          `was altered after the sensor recorded it. Nothing has been submitted.`
      );
    }
  }
}

/**
 * A signature proves a reading was not changed. It says nothing about a reading that was removed,
 * because everything left still verifies perfectly. The sequence is what makes a deletion visible,
 * and it only works because it is inside the signature: a bare column beside it would simply be
 * renumbered.
 *
 * This catches a reading dropped from the middle. It cannot catch readings dropped from the end,
 * which stays a known limit rather than something quietly implied to be covered.
 */
function assertContiguousSequence(
  readings: readonly CanonicalTemperatureReading[],
  sensorId: string
): void {
  // Sorted, a complete run is exactly 1..N, so one predicate covers every way it can be wrong: a
  // duplicate, a run that starts late, and a gap in the middle all show up as a value that is not
  // its own position. Only the wording differs, and that is decided from what was found.
  const sequences = readings.map((reading) => reading.sequence).sort((a, b) => a - b);
  const wrong = sequences.findIndex((value, index) => value !== index + 1);
  if (wrong === -1) {
    return;
  }

  const found = sequences[wrong];
  const expected = wrong + 1;

  if (wrong > 0 && found === sequences[wrong - 1]) {
    throw new ReadingsRejected(
      `Sensor '${sensorId}' reported reading ${found} more than once.`
    );
  }
  if (wrong === 0) {
    throw new ReadingsRejected(
      `Sensor '${sensorId}' starts at reading ${found} rather than 1, so earlier readings ` +
        `are missing.`
    );
  }
  throw new ReadingsRejected(
    `Sensor '${sensorId}' is missing reading ${expected}: the run jumps to ${found}. A reading ` +
      `was removed after the sensor signed it.`
  );
}
