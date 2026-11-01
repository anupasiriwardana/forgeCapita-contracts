// RUN BY THE USER ONLY. Phase 8: failed crowdfund on P3 (goal 0.1, only 0.002 raised, left open on purpose).
// More than one day after the P3 launch, investor B calls refundFailedCrowdfund() to get the deposit back.
// If it is too early this script prints the remaining wait and exits WITHOUT sending, in any mode.
// Note: refundFailedCrowdfund emits no event, so the indexer shows no change for it (see docs/smoke-test-v2.md).
// DRY-RUN by default; set SMOKE_SEND=yes to send. Resumable via scripts/smoke/state/state-<chainId>.json.
//   npx hardhat run scripts/smoke/08-failed-crowdfund.ts --network arbitrumSepoliaSmoke
import { chainNow, connect, escrowAs, log, requireProject, runMain, runPlan } from "./lib.js";
import { formatDuration, isStepDone } from "./pure.js";

async function main(): Promise<void> {
    const ctx = await connect();
    const p3 = requireProject(ctx, "P3");
    if (p3 === undefined) {
        await runPlan(ctx, "Phase 8: failed crowdfund (P3)", []);
        return;
    }
    const project = p3;

    const escrow = await escrowAs(ctx, project, "investorB");
    const [deadline, now] = await Promise.all([escrow.fundingDeadline(), chainNow(ctx)]);
    if (now <= deadline) {
        log(`Too early: P3's funding deadline passes in ${formatDuration(deadline - now)} (deadline timestamp ${deadline}, chain time ${now}).`);
        log("Nothing was sent. Run this script again after the deadline.");
        return;
    }

    await runPlan(ctx, "Phase 8: failed crowdfund (P3)", [
        {
            project: "P3",
            key: "refund:investorB",
            role: "investorB",
            call: "MilestoneEscrow.refundFailedCrowdfund()  [deadline passed and the goal was not reached]",
            needs: ["invest:investorB"],
            isDone: async () => isStepDone(ctx.state, "P3", "invest:investorB") && (await escrow.deposits(ctx.addresses.investorB)) === 0n,
            simulate: async () => escrow.refundFailedCrowdfund.staticCall(),
            send: async () => escrow.refundFailedCrowdfund(),
        },
    ]);
}

runMain(main);
