export interface FabricCommandPlan {
  readonly name: string;
  readonly description: string;
  readonly steps: readonly string[];
}

export function printPlannedCommand(plan: FabricCommandPlan): void {
  console.log(`[fabric-network] ${plan.name}`);
  console.log(plan.description);

  for (const step of plan.steps) {
    console.log(`- TODO: ${step}`);
  }
}
