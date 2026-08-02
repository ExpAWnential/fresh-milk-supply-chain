/**
 * Chaincode entry point. Fabric reads this `contracts` export to learn which contracts the
 * deployed package provides.
 */
import { StakeholderRegistryContract } from "./contracts/StakeholderRegistryContract.js";

export const contracts = [StakeholderRegistryContract];
