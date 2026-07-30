/**
 * The names the two chaincodes register their contracts under. Fixed, because the chaincode
 * declares them.
 *
 * They live here rather than in a route so that routes and ledger readers can share a name without
 * importing each other.
 */
export const STAKEHOLDER_CONTRACT = "StakeholderRegistryContract";
export const BATCH_CONTRACT = "BatchLifecycleContract";
export const TEMPERATURE_CONTRACT = "TemperatureComplianceContract";
