// RUN BY THE USER ONLY. Phase 1: the developer wallet launches the three smoke projects P1, P2 and P3
// through the factory (1,000,000 tokens, milestones "MVP" 50 / "Launch" 50, funding duration 1 day).
// DRY-RUN by default (prints the plan and simulates with staticCall); set the shell variable SMOKE_SEND=yes
// to send. Resumable: finished steps are skipped via scripts/smoke/state/state-<chainId>.json.
//   npx hardhat run scripts/smoke/01-launch.ts --network arbitrumSepoliaSmoke
// Run 02-fund.ts within 24 hours: the funding window is one day.
import { connect, launchStep, runMain, runPlan } from "./lib.js";
import { projectPlan } from "./pure.js";

async function main(): Promise<void> {
    const ctx = await connect();
    await runPlan(ctx, "Phase 1: launch P1, P2, P3", [
        launchStep(ctx, "P1", projectPlan("P1")),
        launchStep(ctx, "P2", projectPlan("P2")),
        launchStep(ctx, "P3", projectPlan("P3")),
    ]);
}

runMain(main);
