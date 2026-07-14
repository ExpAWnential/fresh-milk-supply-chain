import { Contract, Context, Info, Transaction } from "fabric-contract-api";

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
    throw new Error("registerStakeholder is not implemented yet.");
  }

  @Transaction()
  public async updateStakeholder(_ctx: Context, _stakeholderId: string): Promise<void> {
    // TODO: Allow only REGULATOR identities to update stakeholder metadata.
    throw new Error("updateStakeholder is not implemented yet.");
  }

  @Transaction()
  public async suspendStakeholder(_ctx: Context, _stakeholderId: string): Promise<void> {
    // TODO: Allow only REGULATOR identities to suspend stakeholders.
    throw new Error("suspendStakeholder is not implemented yet.");
  }
}
