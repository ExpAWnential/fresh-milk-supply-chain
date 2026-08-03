/**
 * The regulator's on-chain attestation that a public key belongs to a sensor.
 * Only the public key reaches the ledger. The sensor retains the private key used to sign readings.
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
