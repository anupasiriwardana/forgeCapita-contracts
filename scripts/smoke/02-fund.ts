// RUN BY THE USER ONLY. Phase 2: investments and closing.
//   P1: investor A sends 0.03 and investor B sends 0.02 (goal 0.04, raise 0.05); developer closes funding.
//   P2: investor B sends 0.004 (goal 0.004); developer closes funding.
//   P3: investor B sends 0.002 (goal 0.1); P3 stays open on purpose (failed-crowdfund scenario, phase 8).
// DRY-RUN by default; set SMOKE_SEND=yes to send. Resumable via scripts/smoke/state/state-<chainId>.json.
// The funding window is one day from the launch, so run this within 24 hours of 01-launch.ts.
//   npx hardhat run scripts/smoke/02-fund.ts --network arbitrumSepoliaSmoke
import { chainNow, closeStep, connect, investStep, log, requireProject, runMain, runPlan, type StepSpec } from "./lib.js";
import { P1_INVEST_A, P1_INVEST_B, P2_INVEST_B, P3_INVEST_B, fundingWindowLine } from "./pure.js";

async function main(): Promise<void> {
    const ctx = await connect();
    const p1 = requireProject(ctx, "P1");
    const p2 = requireProject(ctx, "P2");
    const p3 = requireProject(ctx, "P3");

    const now = await chainNow(ctx);
    for (const [label, project] of [["P1", p1], ["P2", p2], ["P3", p3]] as const) {
        if (project !== undefined) log(fundingWindowLine(label, BigInt(project.params.fundingDeadline), now));
    }

    const steps: StepSpec[] = [];
    if (p1 !== undefined) {
        steps.push(
            investStep(ctx, "P1", p1, "investorA", P1_INVEST_A),
            investStep(ctx, "P1", p1, "investorB", P1_INVEST_B),
            closeStep(ctx, "P1", p1, ["invest:investorA", "invest:investorB"]),
        );
    }
    if (p2 !== undefined) {
        steps.push(investStep(ctx, "P2", p2, "investorB", P2_INVEST_B), closeStep(ctx, "P2", p2, ["invest:investorB"]));
    }
    if (p3 !== undefined) steps.push(investStep(ctx, "P3", p3, "investorB", P3_INVEST_B));

    await runPlan(ctx, "Phase 2: fund and close", steps);
}

runMain(main);
