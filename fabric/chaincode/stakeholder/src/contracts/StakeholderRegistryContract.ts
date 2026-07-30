// Value import, not "import type": @Transaction identifies the ctx parameter by comparing its
// emitted runtime type against Context, so an erased type import makes Fabric expect an extra
// argument on every transaction.
import { Context, Contract, Info, Returns, Transaction } from "fabric-contract-api";
import {
  Stakeholder,
  StakeholderRole
} from "../models/Stakeholder.js";
import { getInvokingIdentity } from "../utils/identity.js";
import {
  getTransactionMetadata,
  TransactionMetadata
} from "../utils/txContext.js";

const STAKEHOLDER_KEY_PREFIX = "stakeholder";
const CERTIFICATE_KEY_PREFIX = "certificate";

// these two ledger values make first time setup safe and ensure the system always
// has at least one active regulator who can manage the registry
const REGISTRY_INITIALISED_KEY = "registry.initialised";
const ACTIVE_REGULATOR_COUNT_KEY = "registry.activeRegulatorCount";

// in our case Org1 is the regulator organisation
export const REGULATOR_MSP_ID = "Org1MSP";

const VALID_ROLES: ReadonlySet<string> = new Set<StakeholderRole>([
  "REGULATOR",
  "FARM",
  "PROCESSOR",
  "LOGISTICS",
  "RETAILER",
  "ORACLE"
]);

// other contracts only need this small result to make an access decision
// They do not need the stakeholders full certificate or audit information
interface StakeholderSummary {
  readonly stakeholderId: string;
  readonly role: StakeholderRole;
  readonly active: boolean;
}

// remove spaces around a required value and reject it if nothing remains.
function requireValue(value: string, fieldName: string): string {
  const normalised = value.trim();
  if (!normalised) {
    throw new Error(`${fieldName} must not be empty.`);
  }
  return normalised;
}

// accept role names in any letter case then make sure the role is supported
function parseRole(value: string): StakeholderRole {
  const role = requireValue(value, "Role").toUpperCase();
  if (!VALID_ROLES.has(role)) {
    throw new Error(
      `Invalid stakeholder role '${value}'. Expected one of: ${[...VALID_ROLES].join(", ")}.`
    );
  }
  return role as StakeholderRole;
}

// chaincode arguments arrive as strings, so other contracts send allowed roles
// as JSON, for example: ["FARM", "PROCESSOR"]
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
  // create the first regulator. A regulator normally has to register everybody,
  // but no regulator exists when the ledger is brand new. This can run only once.
  @Transaction()
  public async bootstrapRegulator(ctx: Context, stakeholderId: string): Promise<void> {
    // Trust the caller only if belong to the regulator organisation.
    const identity = getInvokingIdentity(ctx);
    if (identity.mspId !== REGULATOR_MSP_ID) {
      throw new Error(
        `Only a member of MSP '${REGULATOR_MSP_ID}' may bootstrap the stakeholder registry.`
      );
    }

    // this means somebody has already created the first regulator.
    if ((await ctx.stub.getState(REGISTRY_INITIALISED_KEY)).length > 0) {
      throw new Error("The stakeholder registry has already been initialised.");
    }

    const id = requireValue(stakeholderId, "Stakeholder ID");
    const metadata = getTransactionMetadata(ctx);
    const stakeholder = this.createStakeholder(
      id,
      "REGULATOR",
      identity.certificateId,
      metadata
    );

    // save the first regulator, remember the count, and permanently mark setup complete.
    await this.putNewStakeholder(ctx, stakeholder);
    await ctx.stub.putState(ACTIVE_REGULATOR_COUNT_KEY, Buffer.from("1"));
    await ctx.stub.putState(REGISTRY_INITIALISED_KEY, Buffer.from(metadata.txId));
    this.emitEvent(ctx, "StakeholderRegistered", stakeholder);
  }

  // Add a new company or system participant and give it a role.
  // Only an already registered, active regulator may do this.
  @Transaction()
  public async registerStakeholder(
    ctx: Context,
    stakeholderId: string,
    role: string,
    certificateId: string
  ): Promise<void> {
    await this.requireActiveRegulator(ctx);

    // Clean and validate all user supplied values before writing anything.
    const id = requireValue(stakeholderId, "Stakeholder ID");
    const parsedRole = parseRole(role);
    const certificate = requireValue(certificateId, "Certificate ID");
    const stakeholder = this.createStakeholder(
      id,
      parsedRole,
      certificate,
      getTransactionMetadata(ctx)
    );

    // putNewStakeholder also rejects duplicate stakeholder IDs and certificates.
    await this.putNewStakeholder(ctx, stakeholder);
    if (parsedRole === "REGULATOR") {
      await this.changeActiveRegulatorCount(ctx, 1);
    }
    this.emitEvent(ctx, "StakeholderRegistered", stakeholder);
  }

  // Change what an existing stakeholder is allowed to do.
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
      throw new Error(
        `Stakeholder '${stakeholder.stakeholderId}' already has role '${newRole}'.`
      );
    }

    // Keep the active regulator count correct when somebody gains or loses that role.
    // The last active regulator is protected so the registry cannot lock itself.
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

  // Temporarily block a stakeholder without deleting its history from the ledger.
  @Transaction()
  public async suspendStakeholder(ctx: Context, stakeholderId: string): Promise<void> {
    await this.requireActiveRegulator(ctx);

    const stakeholder = await this.getStakeholderRecord(ctx, stakeholderId);
    if (!stakeholder.active) {
      throw new Error(`Stakeholder '${stakeholder.stakeholderId}' is already suspended.`);
    }

    // Never allow the only active regulator to suspend itself.
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

  // Allow a previously suspended stakeholder to use the system again.
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

  // Read only lookup
  @Transaction(false)
  @Returns("string")
  public async getStakeholder(ctx: Context, stakeholderId: string): Promise<string> {
    return JSON.stringify(await this.getStakeholderRecord(ctx, stakeholderId));
  }

  // The batch and temperature contracts call this before protected actions
  // It acts like a security guard: registered + active + correct role means allowed
  @Transaction(false)
  @Returns("string")
  public async assertActiveRole(
    ctx: Context,
    certificateId: string,
    allowedRolesJson: string
  ): Promise<string> {
    const certificate = requireValue(certificateId, "Certificate ID");
    const invokingCertificate = getInvokingIdentity(ctx).certificateId;

    // check if the certificate is correct
    if (certificate !== invokingCertificate) {
      throw new Error(
        "The certificate being authorised must match the authenticated transaction caller."
      );
    }

    // Find the business identity connected to the caller's verified certificate
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

    // Return only the information the calling contract needs for its decision.
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

  // Create a new active stakeholder and record who created it and when
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

  // update stakeholder role and stauts while preserving the original creation details
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

  // Save a new stakeholder only when both its business ID and certificate are unused
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

    // Save a link from the certificate ID to the stakeholder ID
    // This makes certificate lookups faster
    await ctx.stub.putState(certificateKey, Buffer.from(stakeholder.stakeholderId));
  }

  // Fabric stores bytes, so convert the stakeholder object to JSON and then to a Buffer
  private async putStakeholder(ctx: Context, stakeholder: Stakeholder): Promise<void> {
    await ctx.stub.putState(
      this.stakeholderKey(ctx, stakeholder.stakeholderId),
      Buffer.from(JSON.stringify(stakeholder))
    );
  }

  // Read and decode a stakeholder, give error when it does not exist
  private async getStakeholderRecord(
    ctx: Context,
    stakeholderId: string
  ): Promise<Stakeholder> {
    const id = requireValue(stakeholderId, "Stakeholder ID");
    const value = await ctx.stub.getState(this.stakeholderKey(ctx, id));
    if (value.length === 0) {
      throw new Error(`Stakeholder '${id}' does not exist.`);
    }
    return JSON.parse(value.toString()) as Stakeholder;
  }

  // Follow the certificate index to find the full stakeholder record
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

  // Check that the caller is an active regulator before allowing the operation
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

  // Read the small counter used to protect the final active regulator
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

  // Increase or decrease the regulator count after a relevant role or status change
  private async changeActiveRegulatorCount(ctx: Context, change: 1 | -1): Promise<void> {
    const count = await this.getActiveRegulatorCount(ctx);
    const nextCount = count + change;
    if (nextCount < 1) {
      throw new Error("The registry must retain at least one active regulator.");
    }
    await ctx.stub.putState(ACTIVE_REGULATOR_COUNT_KEY, Buffer.from(String(nextCount)));
  }

  // Called before suspending or demoting a regulator
  private async assertMoreThanOneActiveRegulator(ctx: Context): Promise<void> {
    if ((await this.getActiveRegulatorCount(ctx)) <= 1) {
      throw new Error("The final active regulator cannot be suspended or lose its role.");
    }
  }

  // Notify the backend when stakeholder information changes
  private emitEvent(ctx: Context, name: string, stakeholder: Stakeholder): void {
    ctx.stub.setEvent(name, Buffer.from(JSON.stringify(stakeholder)));
  }
}
