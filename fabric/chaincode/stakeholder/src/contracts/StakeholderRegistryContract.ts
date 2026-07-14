import { Contract, Context, Info, Returns, Transaction } from "fabric-contract-api";

@Info({
  title: "StakeholderRegistryContract",
  description: "Registers, updates and suspends supply-chain stakeholders."
})
export class StakeholderRegistryContract extends Contract {
  @Transaction()
  public async registerStakeholder(
    _ctx: Context,
    _stakeholderId: string,
    _role: string,
    _certificateId: string
  ): Promise<void> {
    // TODO: Allow only REGULATOR identities to register stakeholders.
    // TODO: Validate supported roles and bind stakeholder records to Fabric certificate IDs.
    // TODO: Reject duplicate stakeholder IDs, and certificate IDs already bound to an active stakeholder.
    throw new Error("registerStakeholder is not implemented yet.");
  }

  @Transaction()
  public async updateStakeholderRole(
    _ctx: Context,
    _stakeholderId: string,
    _role: string
  ): Promise<void> {
    // TODO: Allow only REGULATOR identities to change a stakeholder's role.
    throw new Error("updateStakeholderRole is not implemented yet.");
  }

  @Transaction()
  public async suspendStakeholder(_ctx: Context, _stakeholderId: string): Promise<void> {
    // TODO: Allow only REGULATOR identities to suspend stakeholders.
    throw new Error("suspendStakeholder is not implemented yet.");
  }

  @Transaction()
  public async reactivateStakeholder(_ctx: Context, _stakeholderId: string): Promise<void> {
    // TODO: Allow only REGULATOR identities to reactivate suspended stakeholders.
    throw new Error("reactivateStakeholder is not implemented yet.");
  }

  @Transaction(false)
  @Returns("string")
  public async getStakeholder(_ctx: Context, _stakeholderId: string): Promise<string> {
    // TODO: Return the stakeholder record, or reject when it does not exist.
    throw new Error("getStakeholder is not implemented yet.");
  }

  // Invoked by the supplychain chaincode before every write, so role and suspension checks
  // are answered by the registry that owns them rather than by role data copied into the
  // supplychain contracts' own state.
  @Transaction(false)
  @Returns("string")
  public async assertActiveRole(
    _ctx: Context,
    _certificateId: string,
    _allowedRolesJson: string
  ): Promise<string> {
    // TODO: Resolve the certificate ID to a stakeholder and return that record as JSON.
    // TODO: Reject when the caller is unregistered, suspended, or holds a role outside the allowed set.
    throw new Error("assertActiveRole is not implemented yet.");
  }
}
