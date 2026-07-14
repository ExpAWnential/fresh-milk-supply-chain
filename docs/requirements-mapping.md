# Requirements Mapping

| Requirement | Planned Component | Current Status |
| --- | --- | --- |
| Only a regulator may register, update or suspend stakeholders. | `StakeholderRegistryContract` | TODO placeholder |
| Stakeholders are linked to Fabric certificate IDs. | Chaincode identity utilities | TODO placeholder |
| Supported roles are defined. | Shared chaincode models | TODO placeholder |
| Only FARM or PROCESSOR may create a milk batch. | `BatchLifecycleContract` | TODO placeholder |
| Batch lifecycle transitions are validated on-chain. | `BatchLifecycleContract` | TODO placeholder |
| Invalid or out-of-order events are rejected. | `BatchLifecycleContract` | TODO placeholder |
| Only ORACLE may submit temperature evidence. | `TemperatureComplianceContract` | TODO placeholder |
| Raw readings remain in off-chain PostgreSQL. | `services/storage` | Schema and repository placeholders |
| Oracle canonicalises, calculates statistics and hashes readings. | Oracle service | TODO placeholder |
| Only hash, reference, stats and outcome are stored on-chain. | Oracle service and chaincode | TODO placeholder |
| Unsafe evidence marks the batch as COLD_CHAIN_BREACH. | `TemperatureComplianceContract` | TODO placeholder |
| Breached or recalled batches cannot be delivered. | `BatchLifecycleContract` | TODO placeholder |
| Regulator can recall a batch. | `BatchLifecycleContract` | TODO placeholder |
| Events include transaction ID, timestamp and identity. | Chaincode transaction context utilities | TODO placeholder |
