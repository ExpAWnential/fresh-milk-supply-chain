import { printPlannedCommand } from "./commands.js";

printPlannedCommand({
  name: "start",
  description: "Start the local Hyperledger Fabric network.",
  steps: [
    "Define organizations, peers, orderer and channel topology.",
    "Start required Docker containers.",
    "Create and join the application channel."
  ]
});
