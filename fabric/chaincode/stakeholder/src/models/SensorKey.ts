/**
 * The regulator's attestation that a public key belongs to a sensor.
 *
 * Only the public half is ever on the ledger, which is the point: it is enough for anyone to check
 * a reading's signature, and useless for producing one. The private half stays in the device and
 * never reaches this network.
 *
 * The registry holds this rather than the temperature contract because it is an attestation of an
 * identity by the regulator, which is what this contract already does for companies.
 */
export type SensorKeyAlgorithm = "ed25519";

export interface SensorKey {
  readonly sensorId: string;
  // Base64 of the DER SPKI form, which is 44 bytes for Ed25519.
  readonly publicKey: string;
  readonly algorithm: SensorKeyAlgorithm;
  // Revoked rather than deleted, so readings signed before a compromise can still be told apart
  // from readings signed after it.
  readonly active: boolean;
  readonly registeredByStakeholderId: string;
  readonly registeredTxId: string;
  readonly registeredAt: string;
  readonly updatedByStakeholderId: string;
  readonly updatedTxId: string;
  readonly updatedAt: string;
}
