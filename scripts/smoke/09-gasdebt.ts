// RUN BY THE USER ONLY. Phase 9 (OPTIONAL): gas-ledger scenario on a fourth project P4.
// P4 has a single milestone (100%), investor A is the only investor, and the raise (also the goal) is
// 22 x registry.maxCostPerAction() read live (override: shell variable SMOKE_RAISE_WEI, below 0.05 native).
// With that raise the gas budget is 1.1 caps and the ceiling 4.235 caps (1.1 + 15% of 20.9), so four relayer actions can never trip
// "Gas ceiling exceeded". The relayer then runs claimTokensFor, stakeWithPermit, voteBySig and executeMilestone.
// BEST EFFORT: GasDebtRecovered is emitted only when the booked cost exceeds the budget (5% of the raise). The
// booked cost per action is min(real cost, cap); if real costs are well below the cap there is no overflow, no
// GasDebtRecovered event and no gas_debt row. The script prints the ledger at the end so you can see which case occurred.
// DRY-RUN by default; set SMOKE_SEND=yes to send. Resumable via scripts/smoke/state/state-<chainId>.json.
//   npx hardhat run scripts/smoke/09-gasdebt.ts --network arbitrumSepoliaSmoke
import {
    closeStep,
    connect,
    escrowAs,
    investStep,
    launchStep,
    log,
    raiseOverride,
    registryAs,
    runMain,
    runPlan,
    shareOf,
    signPermit,
    signVote,
    distributorAs,
    type SmokeContext,
    type StepSpec,
} from "./lib.js";
import { formatNative, gasLimits, p4RaiseWei, projectPlan, type ProjectRecord } from "./pure.js";

function followUpSteps(ctx: SmokeContext, project: ProjectRecord, raise: bigint): StepSpec[] {
    const investor = ctx.addresses.investorA;
    return [
        investStep(ctx, "P4", project, "investorA", raise),
        closeStep(ctx, "P4", project, ["invest:investorA"]),
        {
            project: "P4",
            key: "claim:investorA",
            role: "relayer",
            call: `MilestoneEscrow.claimTokensFor(${investor})  [sponsored]`,
            needs: ["close"],
            isDone: async () => (await escrowAs(ctx, project, "relayer")).hasClaimedTokens(investor),
            simulate: async () => (await escrowAs(ctx, project, "relayer")).claimTokensFor.staticCall(investor),
            send: async () => (await escrowAs(ctx, project, "relayer")).claimTokensFor(investor),
        },
        {
            project: "P4",
            key: "stake:investorA",
            role: "relayer",
            call: "DividendDistributor.stakeWithPermit(owner=A, all A's tokens, deadline, v, r, s)  [sponsored]",
            needs: ["claim:investorA"],
            isDone: async () => (await (await distributorAs(ctx, project, "relayer")).stakedBalance(investor)) > 0n,
            simulate: async () => {
                const amount = await shareOf(ctx, project, "investorA");
                const permit = await signPermit(ctx, project, "investorA", amount);
                return (await distributorAs(ctx, project, "relayer")).stakeWithPermit.staticCall(investor, amount, permit.deadline, permit.v, permit.r, permit.s);
            },
            send: async () => {
                const amount = await shareOf(ctx, project, "investorA");
                const permit = await signPermit(ctx, project, "investorA", amount);
                return (await distributorAs(ctx, project, "relayer")).stakeWithPermit(investor, amount, permit.deadline, permit.v, permit.r, permit.s);
            },
        },
        {
            project: "P4",
            key: "m1.start",
            role: "developer",
            call: "MilestoneEscrow.startMilestone(0)",
            needs: ["close"],
            isDone: async () => {
                const milestone = await (await escrowAs(ctx, project, "developer")).milestones(0n);
                return milestone.isVotingOpen || milestone.isExecuted;
            },
            simulate: async () => (await escrowAs(ctx, project, "developer")).startMilestone.staticCall(0n),
            send: async () => (await escrowAs(ctx, project, "developer")).startMilestone(0n),
        },
        {
            project: "P4",
            key: "m1.voteA",
            role: "relayer",
            call: "MilestoneEscrow.voteBySig(voter=investorA, yes, deadline, signature)  [sponsored]",
            needs: ["m1.start", "stake:investorA"],
            isDone: async () => (await escrowAs(ctx, project, "relayer")).hasVoted(0n, investor),
            simulate: async () => {
                const signed = await signVote(ctx, project, "investorA", true);
                return (await escrowAs(ctx, project, "relayer")).voteBySig.staticCall(investor, true, signed.deadline, signed.signature);
            },
            send: async () => {
                const signed = await signVote(ctx, project, "investorA", true);
                return (await escrowAs(ctx, project, "relayer")).voteBySig(investor, true, signed.deadline, signed.signature);
            },
        },
        {
            project: "P4",
            key: "m1.exec",
            role: "relayer",
            call: "MilestoneEscrow.executeMilestone()  [sponsored, final milestone]",
            needs: ["m1.voteA"],
            isDone: async () => (await (await escrowAs(ctx, project, "relayer")).milestones(0n)).isExecuted,
            simulate: async () => (await escrowAs(ctx, project, "relayer")).executeMilestone.staticCall(),
            send: async () => (await escrowAs(ctx, project, "relayer")).executeMilestone(),
        },
    ];
}

async function reportLedger(ctx: SmokeContext, project: ProjectRecord): Promise<void> {
    const escrow = await escrowAs(ctx, project, "guardian");
    const [budget, spent, recovered] = await Promise.all([escrow.gasBudget(), escrow.gasSpent(), escrow.gasRecovered()]);
    const overflow = spent > budget ? spent - budget : 0n;
    log(`\nP4 gas ledger: budget ${formatNative(budget)}, spent ${formatNative(spent)}, recovered ${formatNative(recovered)} ${ctx.chain.nativeSymbol}`);
    log(
        overflow > 0n
            ? `Overflow ${formatNative(overflow)}: GasDebtRecovered should appear (amount ${formatNative(recovered)}) once the milestone has executed.`
            : "No overflow: booked costs stayed within the 5% budget, so there is no GasDebtRecovered event and no gas_debt row. This is expected when real costs are below the cap.",
    );
}

async function main(): Promise<void> {
    const ctx = await connect();
    const registry = await registryAs(ctx, "guardian");
    const existing = ctx.state.projects.P4;
    const raise = existing !== undefined ? BigInt(existing.params.goalWei) : p4RaiseWei(await registry.maxCostPerAction(), raiseOverride());
    const limits = gasLimits(raise);
    log(`P4 raise (= goal) ${formatNative(raise)} ${ctx.chain.nativeSymbol}; gas budget ${formatNative(limits.budget)}, ceiling ${formatNative(limits.ceiling)}`);

    let project = existing;
    if (project === undefined) {
        await runPlan(ctx, "Phase 9a: launch P4", [launchStep(ctx, "P4", projectPlan("P4", raise))]);
        project = ctx.state.projects.P4;
    }
    if (project === undefined) {
        log("\nAfter the launch, phase 9b would run: A invests the raise, developer closes, relayer claimTokensFor / stakeWithPermit / voteBySig / executeMilestone.");
        log("Send the launch first (SMOKE_SEND=yes), then dry-run this script again to see the full plan.");
        return;
    }

    await runPlan(ctx, "Phase 9b: gas-ledger scenario (P4)", followUpSteps(ctx, project, raise));
    await reportLedger(ctx, project);
}

runMain(main);
