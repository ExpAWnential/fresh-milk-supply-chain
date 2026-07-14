import { printPlannedCommand } from "./commands.js";

printPlannedCommand({
  name: "deploy-chaincode",
  description: "Package, install, approve and commit the chaincode.",
  steps: [
    "Package the TypeScript chaincode.",
    "Install chaincode on peer organizations.",
    "Approve the chaincode definition.",
    "Commit the chaincode definition to the channel."
  ]
});
