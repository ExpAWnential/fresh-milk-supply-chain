/**
 * Chaincode entry point. Fabric reads this `contracts` export to learn which contracts the
 * deployed package provides.
 *
 * Both live in one chaincode so they can read and write the same batch records: a temperature
 * breach has to be able to change the batch it belongs to.
 */
import { BatchLifecycleContract } from "./contracts/BatchLifecycleContract.js";
import { TemperatureComplianceContract } from "./contracts/TemperatureComplianceContract.js";

export const contracts = [BatchLifecycleContract, TemperatureComplianceContract];
