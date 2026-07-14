import { printPlannedCommand } from "./commands.js";

// Two chaincodes are deployed separately so that the supply-chain contracts can delegate
// role checks to the stakeholder registry through a cross-chaincode invocation.
for (const chaincodeName of ["stakeholder", "supplychain"]) {
  printPlannedCommand({
    name: `deploy-chaincode:${chaincodeName}`,
    description: `Package, install, approve and commit the ${chaincodeName} chaincode.`,
    steps: [
      `Package the TypeScript ${chaincodeName} chaincode.`,
      "Install chaincode on peer organizations.",
      "Approve the chaincode definition.",
      "Commit the chaincode definition to the channel."
    ]
  });
}
