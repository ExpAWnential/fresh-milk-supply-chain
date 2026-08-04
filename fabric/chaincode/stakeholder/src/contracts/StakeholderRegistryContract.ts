/**
 * The on-chain identity registry for the consortium.
 *
 * This contract is the source of truth for who may act as each stakeholder, whether that identity
 * is currently active, and which public key belongs to a sensor. Other chaincode asks this contract
 * to authorise callers instead of trusting roles supplied by an API request.
 */

// Fabric's decorators inspect Context at runtime, so it must remain a value import.
import { Context, Contract, Info, Returns, Transaction } from "fabric-contract-api";
import { SensorKey, SensorKeyAlgorithm } from "../models/SensorKey.js";
import { Stakeholder, StakeholderRole } from "../models/Stakeholder.js";
import { getInvokingIdentity } from "../utils/identity.js";
import { getTransactionMetadata, TransactionMetadata } from "../utils/txContext.js";

const STAKEHOLDER_KEY_PREFIX = "stakeholder";
const CERTIFICATE_KEY_PREFIX = "certificate";
const SENSOR_KEY_PREFIX = "sensorKey";

// These records make initial setup one-time-only and prevent the last regulator being disabled.
const REGISTRY_INITIALISED_KEY = "registry.initialised";
const ACTIVE_REGULATOR_COUNT_KEY = "registry.activeRegulatorCount";

// Only this Fabric organisation may create the first regulator.
export const REGULATOR_MSP_ID = "RegulatorMSP";

const VALID_ROLES: ReadonlySet<string> = new Set<StakeholderRole>([
  "REGULATOR",
  "FARM",
  "PROCESSOR",
  "LOGISTICS",
  "RETAILER",
  "ORACLE"
]);

// Verifiers must explicitly support every algorithm accepted here.
const VALID_ALGORITHMS: ReadonlySet<string> = new Set<SensorKeyAlgorithm>(["ed25519"]);

// Ed25519 public keys use a 44-byte DER SPKI representation.
const ED25519_SPKI_BYTES = 44;

// Other contracts need only these fields to make an access decision.
interface StakeholderSummary {
  readonly stakeholderId: string;
  readonly role: StakeholderRole;
  readonly active: boolean;
}

function requireValue(value: string, fieldName: string): string {
  const normalised = value.trim();
  if (!normalised) {
    throw new Error(`${fieldName} must not be empty.`);
  }
  return normalised;
}

function parseRole(value: string): StakeholderRole {
  const role = requireValue(value, "Role").toUpperCase();
  if (!VALID_ROLES.has(role)) {
    throw new Error(
      `Invalid stakeholder role '${value}'. Expected one of: ${[...VALID_ROLES].join(", ")}.`
    );
  }
  return role as StakeholderRole;
}

function parseAlgorithm(value: string): SensorKeyAlgorithm {
  const algorithm = requireValue(value, "Algorithm").toLowerCase();
  if (!VALID_ALGORITHMS.has(algorithm)) {
    throw new Error(
      `Invalid signature algorithm '${value}'. Expected one of: ` +
        `${[...VALID_ALGORITHMS].join(", ")}.`
    );
  }
  return algorithm as SensorKeyAlgorithm;
}

// Buffer.from accepts stray characters, so round-trip the value to enforce strict base64.
function parsePublicKey(value: string): string {
  const publicKey = requireValue(value, "Public key");
  const decoded = Buffer.from(publicKey, "base64");

  if (decoded.toString("base64") !== publicKey) {
    throw new Error("The public key must be base64 with no stray characters.");
  }
  if (decoded.length !== ED25519_SPKI_BYTES) {
    throw new Error(
      `An ed25519 public key must be ${ED25519_SPKI_BYTES} bytes in DER SPKI form, ` +
        `but this one is ${decoded.length}.`
    );
  }
  return publicKey;
}

// Cross-chaincode arguments are strings, so allowed roles arrive as a JSON array.
function parseAllowedRoles(value: string): readonly StakeholderRole[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Allowed roles must be a valid JSON array.");
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("Allowed roles must be a non-empty JSON array.");
  }

  if (!parsed.every((role): role is string => typeof role === "string")) {
    throw new Error("Every allowed role must be a string.");
  }

  return [...new Set(parsed.map(parseRole))];
}

@Info({
  title: "StakeholderRegistryContract",
  description: "Registers, updates and suspends supply-chain stakeholders."
})
export class StakeholderRegistryContract extends Contract {
  /**
   * Creates the first regulator when the registry is empty.
   * This narrowly scoped exception breaks the setup cycle, then permanently closes itself.
   */
  @Transaction()
  public async bootstrapRegulator(ctx: Context, stakeholderId: string): Promise<void> {
    const identity = getInvokingIdentity(ctx);
    if (identity.mspId !== REGULATOR_MSP_ID) {
      throw new Error(
        `Only a member of MSP '${REGULATOR_MSP_ID}' may bootstrap the stakeholder registry.`
      );
    }

    if ((await ctx.stub.getState(REGISTRY_INITIALISED_KEY)).length > 0) {
      throw new Error("The stakeholder registry has already been initialised.");
    }

    const id = requireValue(stakeholderId, "Stakeholder ID");
    const metadata = getTransactionMetadata(ctx);
    const stakeholder = this.createStakeholder(id, "REGULATOR", identity.certificateId, metadata);

    await this.putNewStakeholder(ctx, stakeholder);
    await ctx.stub.putState(ACTIVE_REGULATOR_COUNT_KEY, Buffer.from("1"));
    await ctx.stub.putState(REGISTRY_INITIALISED_KEY, Buffer.from(metadata.txId));
    this.emitEvent(ctx, "StakeholderRegistered", stakeholder);
  }

  /** Registers a stakeholder only after an active regulator vouches for its role and certificate. */
  @Transaction()
  public async registerStakeholder(
    ctx: Context,
    stakeholderId: string,
    role: string,
    certificateId: string
  ): Promise<void> {
    await this.requireActiveRegulator(ctx);

    const id = requireValue(stakeholderId, "Stakeholder ID");
    const parsedRole = parseRole(role);
    const certificate = requireValue(certificateId, "Certificate ID");
    const stakeholder = this.createStakeholder(
      id,
      parsedRole,
      certificate,
      getTransactionMetadata(ctx)
    );

    await this.putNewStakeholder(ctx, stakeholder);
    if (parsedRole === "REGULATOR") {
      await this.changeActiveRegulatorCount(ctx, 1);
    }
    this.emitEvent(ctx, "StakeholderRegistered", stakeholder);
  }

  /** Changes a stakeholder's role without allowing the active regulator count to reach zero. */
  @Transaction()
  public async updateStakeholderRole(
    ctx: Context,
    stakeholderId: string,
    role: string
  ): Promise<void> {
    await this.requireActiveRegulator(ctx);

    const stakeholder = await this.getStakeholderRecord(ctx, stakeholderId);
    const newRole = parseRole(role);
    if (stakeholder.role === newRole) {
      throw new Error(`Stakeholder '${stakeholder.stakeholderId}' already has role '${newRole}'.`);
    }

    // Update the lockout guard when this change adds or removes an active regulator.
    if (stakeholder.active && stakeholder.role === "REGULATOR") {
      await this.assertMoreThanOneActiveRegulator(ctx);
      await this.changeActiveRegulatorCount(ctx, -1);
    } else if (stakeholder.active && newRole === "REGULATOR") {
      await this.changeActiveRegulatorCount(ctx, 1);
    }

    const updated = this.updateStakeholder(stakeholder, getTransactionMetadata(ctx), {
      role: newRole
    });
    await this.putStakeholder(ctx, updated);
    this.emitEvent(ctx, "StakeholderRoleUpdated", updated);
  }

  /** Removes a stakeholder's access while retaining its identity and audit history. */
  @Transaction()
  public async suspendStakeholder(ctx: Context, stakeholderId: string): Promise<void> {
    await this.requireActiveRegulator(ctx);

    const stakeholder = await this.getStakeholderRecord(ctx, stakeholderId);
    if (!stakeholder.active) {
      throw new Error(`Stakeholder '${stakeholder.stakeholderId}' is already suspended.`);
    }

    if (stakeholder.role === "REGULATOR") {
      await this.assertMoreThanOneActiveRegulator(ctx);
      await this.changeActiveRegulatorCount(ctx, -1);
    }

    const updated = this.updateStakeholder(stakeholder, getTransactionMetadata(ctx), {
      active: false
    });
    await this.putStakeholder(ctx, updated);
    this.emitEvent(ctx, "StakeholderSuspended", updated);
  }

  /** Restores access to a suspended stakeholder under regulator control. */
  @Transaction()
  public async reactivateStakeholder(ctx: Context, stakeholderId: string): Promise<void> {
    await this.requireActiveRegulator(ctx);

    const stakeholder = await this.getStakeholderRecord(ctx, stakeholderId);
    if (stakeholder.active) {
      throw new Error(`Stakeholder '${stakeholder.stakeholderId}' is already active.`);
    }

    if (stakeholder.role === "REGULATOR") {
      await this.changeActiveRegulatorCount(ctx, 1);
    }

    const updated = this.updateStakeholder(stakeholder, getTransactionMetadata(ctx), {
      active: true
    });
    await this.putStakeholder(ctx, updated);
    this.emitEvent(ctx, "StakeholderReactivated", updated);
  }

  /** Returns one stakeholder record after confirming the caller is an active participant. */
  @Transaction(false)
  @Returns("string")
  public async getStakeholder(ctx: Context, stakeholderId: string): Promise<string> {
    await this.requireActiveStakeholder(ctx);
    return JSON.stringify(await this.getStakeholderRecord(ctx, stakeholderId));
  }

  /** Records the public key that participants will trust when checking a sensor's signatures. */
  @Transaction()
  public async registerSensorKey(
    ctx: Context,
    sensorId: string,
    publicKey: string,
    algorithm: string
  ): Promise<void> {
    const regulator = await this.requireActiveRegulator(ctx);

    const id = requireValue(sensorId, "Sensor ID");
    const key = parsePublicKey(publicKey);
    const parsedAlgorithm = parseAlgorithm(algorithm);
    const metadata = getTransactionMetadata(ctx);

    const sensorKeyLedgerKey = this.sensorKeyKey(ctx, id);
    // Never replace a key silently because existing readings were signed with the original key.
    if ((await ctx.stub.getState(sensorKeyLedgerKey)).length > 0) {
      throw new Error(`Sensor '${id}' already has a registered key.`);
    }

    const sensorKey: SensorKey = {
      sensorId: id,
      publicKey: key,
      algorithm: parsedAlgorithm,
      active: true,
      registeredByStakeholderId: regulator.stakeholderId,
      registeredTxId: metadata.txId,
      registeredAt: metadata.timestamp,
      updatedByStakeholderId: regulator.stakeholderId,
      updatedTxId: metadata.txId,
      updatedAt: metadata.timestamp
    };

    await this.putSensorKey(ctx, sensorKey);
    this.emitEvent(ctx, "SensorKeyRegistered", sensorKey);
  }

  /** Revokes future trust in a sensor key without deleting the key's audit record. */
  @Transaction()
  public async revokeSensorKey(ctx: Context, sensorId: string): Promise<void> {
    const regulator = await this.requireActiveRegulator(ctx);

    const sensorKey = await this.getSensorKeyRecord(ctx, sensorId);
    if (!sensorKey.active) {
      throw new Error(`Sensor '${sensorKey.sensorId}' is already revoked.`);
    }

    const metadata = getTransactionMetadata(ctx);
    const revoked: SensorKey = {
      ...sensorKey,
      active: false,
      updatedByStakeholderId: regulator.stakeholderId,
      updatedTxId: metadata.txId,
      updatedAt: metadata.timestamp
    };

    await this.putSensorKey(ctx, revoked);
    this.emitEvent(ctx, "SensorKeyRevoked", revoked);
  }

  /**
   * Restores trust in a key the regulator had withdrawn, for a device that has been reinspected.
   *
   * The audit record keeps every step, so a key that was revoked and restored is not the same
   * thing as one that was never doubted.
   */
  @Transaction()
  public async reactivateSensorKey(ctx: Context, sensorId: string): Promise<void> {
    const regulator = await this.requireActiveRegulator(ctx);

    const sensorKey = await this.getSensorKeyRecord(ctx, sensorId);
    if (sensorKey.active) {
      throw new Error(`Sensor '${sensorKey.sensorId}' is already active.`);
    }

    const metadata = getTransactionMetadata(ctx);
    const restored: SensorKey = {
      ...sensorKey,
      active: true,
      updatedByStakeholderId: regulator.stakeholderId,
      updatedTxId: metadata.txId,
      updatedAt: metadata.timestamp
    };

    await this.putSensorKey(ctx, restored);
    this.emitEvent(ctx, "SensorKeyReactivated", restored);
  }

  /** Returns the public key and status needed to verify a sensor's readings. */
  @Transaction(false)
  @Returns("string")
  public async getSensorKey(ctx: Context, sensorId: string): Promise<string> {
    await this.requireActiveStakeholder(ctx);
    return JSON.stringify(await this.getSensorKeyRecord(ctx, sensorId));
  }

  /**
   * Authorises a cross-chaincode call using the certificate Fabric authenticated for this transaction.
   * The certificate argument must match the invoker, so a caller cannot ask about somebody else.
   */
  @Transaction(false)
  @Returns("string")
  public async assertActiveRole(
    ctx: Context,
    certificateId: string,
    allowedRolesJson: string
  ): Promise<string> {
    const certificate = requireValue(certificateId, "Certificate ID");
    const invokingCertificate = getInvokingIdentity(ctx).certificateId;

    if (certificate !== invokingCertificate) {
      throw new Error(
        "The certificate being authorised must match the authenticated transaction caller."
      );
    }

    const allowedRoles = parseAllowedRoles(allowedRolesJson);
    const stakeholder = await this.getStakeholderByCertificate(ctx, certificate);

    if (!stakeholder.active) {
      throw new Error(`Stakeholder '${stakeholder.stakeholderId}' is suspended.`);
    }
    if (!allowedRoles.includes(stakeholder.role)) {
      throw new Error(
        `Stakeholder '${stakeholder.stakeholderId}' has role '${stakeholder.role}', ` +
          `but this operation requires one of: ${allowedRoles.join(", ")}.`
      );
    }

    const summary: StakeholderSummary = {
      stakeholderId: stakeholder.stakeholderId,
      role: stakeholder.role,
      active: stakeholder.active
    };
    return JSON.stringify(summary);
  }

  private stakeholderKey(ctx: Context, stakeholderId: string): string {
    return ctx.stub.createCompositeKey(STAKEHOLDER_KEY_PREFIX, [stakeholderId]);
  }

  private certificateKey(ctx: Context, certificateId: string): string {
    return ctx.stub.createCompositeKey(CERTIFICATE_KEY_PREFIX, [certificateId]);
  }

  private sensorKeyKey(ctx: Context, sensorId: string): string {
    return ctx.stub.createCompositeKey(SENSOR_KEY_PREFIX, [sensorId]);
  }

  private async putSensorKey(ctx: Context, sensorKey: SensorKey): Promise<void> {
    await ctx.stub.putState(
      this.sensorKeyKey(ctx, sensorKey.sensorId),
      Buffer.from(JSON.stringify(sensorKey))
    );
  }

  private async getSensorKeyRecord(ctx: Context, sensorId: string): Promise<SensorKey> {
    const id = requireValue(sensorId, "Sensor ID");
    const stored = await ctx.stub.getState(this.sensorKeyKey(ctx, id));
    if (stored.length === 0) {
      throw new Error(`Sensor '${id}' has no registered key.`);
    }
    return JSON.parse(stored.toString()) as SensorKey;
  }

  private createStakeholder(
    stakeholderId: string,
    role: StakeholderRole,
    certificateId: string,
    metadata: TransactionMetadata
  ): Stakeholder {
    return {
      stakeholderId,
      role,
      certificateId,
      active: true,
      createdTxId: metadata.txId,
      createdAt: metadata.timestamp,
      createdByCertificateId: metadata.invokingCertificateId,
      updatedTxId: metadata.txId,
      updatedAt: metadata.timestamp,
      updatedByCertificateId: metadata.invokingCertificateId
    };
  }

  // Preserve creation metadata while recording the latest change.
  private updateStakeholder(
    stakeholder: Stakeholder,
    metadata: TransactionMetadata,
    changes: Partial<Pick<Stakeholder, "role" | "active">>
  ): Stakeholder {
    return {
      ...stakeholder,
      ...changes,
      updatedTxId: metadata.txId,
      updatedAt: metadata.timestamp,
      updatedByCertificateId: metadata.invokingCertificateId
    };
  }

  // Enforce one ledger record per business ID and certificate.
  private async putNewStakeholder(ctx: Context, stakeholder: Stakeholder): Promise<void> {
    const stakeholderKey = this.stakeholderKey(ctx, stakeholder.stakeholderId);
    if ((await ctx.stub.getState(stakeholderKey)).length > 0) {
      throw new Error(`Stakeholder '${stakeholder.stakeholderId}' already exists.`);
    }

    const certificateKey = this.certificateKey(ctx, stakeholder.certificateId);
    if ((await ctx.stub.getState(certificateKey)).length > 0) {
      throw new Error("The certificate ID is already registered to a stakeholder.");
    }

    await this.putStakeholder(ctx, stakeholder);

    // Maintain a certificate index for authorisation lookups.
    await ctx.stub.putState(certificateKey, Buffer.from(stakeholder.stakeholderId));
  }

  private async putStakeholder(ctx: Context, stakeholder: Stakeholder): Promise<void> {
    await ctx.stub.putState(
      this.stakeholderKey(ctx, stakeholder.stakeholderId),
      Buffer.from(JSON.stringify(stakeholder))
    );
  }

  private async getStakeholderRecord(ctx: Context, stakeholderId: string): Promise<Stakeholder> {
    const id = requireValue(stakeholderId, "Stakeholder ID");
    const value = await ctx.stub.getState(this.stakeholderKey(ctx, id));
    if (value.length === 0) {
      throw new Error(`Stakeholder '${id}' does not exist.`);
    }
    return JSON.parse(value.toString()) as Stakeholder;
  }

  // Resolve the authenticated certificate through the secondary index.
  private async getStakeholderByCertificate(
    ctx: Context,
    certificateId: string
  ): Promise<Stakeholder> {
    const value = await ctx.stub.getState(this.certificateKey(ctx, certificateId));
    if (value.length === 0) {
      throw new Error("The invoking certificate is not registered to a stakeholder.");
    }
    return this.getStakeholderRecord(ctx, value.toString());
  }

  private async requireActiveStakeholder(ctx: Context): Promise<Stakeholder> {
    const identity = getInvokingIdentity(ctx);
    const stakeholder = await this.getStakeholderByCertificate(ctx, identity.certificateId);
    if (!stakeholder.active) {
      throw new Error(`Stakeholder '${stakeholder.stakeholderId}' is suspended.`);
    }
    return stakeholder;
  }

  private async requireActiveRegulator(ctx: Context): Promise<Stakeholder> {
    const identity = getInvokingIdentity(ctx);
    const stakeholder = await this.getStakeholderByCertificate(ctx, identity.certificateId);

    if (!stakeholder.active) {
      throw new Error(`Stakeholder '${stakeholder.stakeholderId}' is suspended.`);
    }
    if (stakeholder.role !== "REGULATOR") {
      throw new Error("Only an active REGULATOR stakeholder may perform this operation.");
    }
    return stakeholder;
  }

  // Validate the persisted counter before using it as the lockout guard.
  private async getActiveRegulatorCount(ctx: Context): Promise<number> {
    const value = await ctx.stub.getState(ACTIVE_REGULATOR_COUNT_KEY);
    if (value.length === 0) {
      throw new Error("The stakeholder registry has not been initialised.");
    }

    const count = Number(value.toString());
    if (!Number.isSafeInteger(count) || count < 1) {
      throw new Error("The active regulator count stored on the ledger is invalid.");
    }
    return count;
  }

  private async changeActiveRegulatorCount(ctx: Context, change: 1 | -1): Promise<void> {
    const count = await this.getActiveRegulatorCount(ctx);
    const nextCount = count + change;
    if (nextCount < 1) {
      throw new Error("The registry must retain at least one active regulator.");
    }
    await ctx.stub.putState(ACTIVE_REGULATOR_COUNT_KEY, Buffer.from(String(nextCount)));
  }

  private async assertMoreThanOneActiveRegulator(ctx: Context): Promise<void> {
    if ((await this.getActiveRegulatorCount(ctx)) <= 1) {
      throw new Error("The final active regulator cannot be suspended or lose its role.");
    }
  }

  // Fabric retains only the last event emitted by a transaction, so each write emits once.
  private emitEvent(ctx: Context, name: string, record: Stakeholder | SensorKey): void {
    ctx.stub.setEvent(name, Buffer.from(JSON.stringify(record)));
  }
}
