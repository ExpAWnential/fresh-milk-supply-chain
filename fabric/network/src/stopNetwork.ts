import { printPlannedCommand } from "./commands.js";

printPlannedCommand({
  name: "stop",
  description: "Stop the local Hyperledger Fabric network.",
  steps: [
    "Stop Fabric Docker containers.",
    "Preserve or clean generated artifacts according to the selected demo workflow."
  ]
});
