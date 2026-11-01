// RUN BY THE USER ONLY. Phase 6: milestone voting, Guardian freeze and execution on P1.
//   M1: developer startMilestone(0); B voteBySig yes by the RELAYER (SponsoredGas action 2); A votes yes (user-paid);
//       the RELAYER executes (SponsoredGas action 3, account 0x0).
//   M2: developer startMilestone(1); B votes no and A votes yes (user-paid, yes weight > 50% of the public supply);
//       the Guardian freezes milestones; a staticCall of executeMilestone must revert "Milestones frozen";
//       the Guardian unfreezes; the RELAYER executes the final milestone (MilestoneExecuted, ProjectCompleted,
//       20% developer vesting); finally B withdraws part of its stake (Withdrawn). The withdraw step needs P1 `pay` from phase 5 first (it
//       lowers the staked total from 672000 to 640000, which would change A's yield): run 05-revenue.ts before it.
// DRY-RUN by default; set SMOKE_SEND=yes to send. Resumable via scripts/smoke/state/state-<chainId>.json.
//   npx hardhat run scripts/smoke/06-vote-execute.ts --network arbitrumSepoliaSmoke
import {
    connect,
    distributorAs,
    escrowAs,
    expectRevert,
    requireProject,
    runMain,
    runPlan,
    shareOf,
    signVote,
    type StepSpec,
} from "./lib.js";
import { P1_STAKE_B_PERCENT, P1_WITHDRAW_B, formatTokens, stakeAmount, type ProjectRecord, type Role } from "./pure.js";

async function main(): Promise<void> {
    const ctx = await connect();
    const p1 = requireProject(ctx, "P1");
    if (p1 === undefined) {
        await runPlan(ctx, "Phase 6: vote, freeze, execute (P1)", []);
        return;
    }
    const project: ProjectRecord = p1;

    const start = (key: string, index: bigint, needs: readonly string[]): StepSpec => ({
        project: "P1",
        key,
        role: "developer",
        call: `MilestoneEscrow.startMilestone(${index})`,
        needs,
        isDone: async () => {
            const milestone = await (await escrowAs(ctx, project, "developer")).milestones(index);
            return milestone.isVotingOpen || milestone.isExecuted;
        },
        simulate: async () => (await escrowAs(ctx, project, "developer")).startMilestone.staticCall(index),
        send: async () => (await escrowAs(ctx, project, "developer")).startMilestone(index),
    });

    const voteDirect = (key: string, index: bigint, voter: Role, support: boolean, needs: readonly string[]): StepSpec => ({
        project: "P1",
        key,
        role: voter,
        call: `MilestoneEscrow.vote(${support ? "yes" : "no"})  [milestone ${index}]`,
        needs,
        isDone: async () => (await escrowAs(ctx, project, voter)).hasVoted(index, ctx.addresses[voter]),
        simulate: async () => (await escrowAs(ctx, project, voter)).vote.staticCall(support),
        send: async () => (await escrowAs(ctx, project, voter)).vote(support),
    });

    const voteRelayed = (key: string, index: bigint, voter: Role, support: boolean, needs: readonly string[]): StepSpec => ({
        project: "P1",
        key,
        role: "relayer",
        call: `MilestoneEscrow.voteBySig(voter=${voter}, ${support ? "yes" : "no"}, deadline, signature)  [${voter} signs EIP-712 Vote, milestone ${index}]`,
        needs,
        isDone: async () => (await escrowAs(ctx, project, "relayer")).hasVoted(index, ctx.addresses[voter]),
        simulate: async () => {
            const signed = await signVote(ctx, project, voter, support);
            return (await escrowAs(ctx, project, "relayer")).voteBySig.staticCall(ctx.addresses[voter], support, signed.deadline, signed.signature);
        },
        send: async () => {
            const signed = await signVote(ctx, project, voter, support);
            return (await escrowAs(ctx, project, "relayer")).voteBySig(ctx.addresses[voter], support, signed.deadline, signed.signature);
        },
    });

    const execute = (key: string, index: bigint, needs: readonly string[]): StepSpec => ({
        project: "P1",
        key,
        role: "relayer",
        call: `MilestoneEscrow.executeMilestone()  [milestone ${index}, relayer-sponsored]`,
        needs,
        isDone: async () => (await (await escrowAs(ctx, project, "relayer")).milestones(index)).isExecuted,
        simulate: async () => (await escrowAs(ctx, project, "relayer")).executeMilestone.staticCall(),
        send: async () => (await escrowAs(ctx, project, "relayer")).executeMilestone(),
    });

    const staked = ["stake:investorA", "stake:investorB"];
    const steps: StepSpec[] = [
        start("m1.start", 0n, ["close"]),
        voteRelayed("m1.voteB", 0n, "investorB", true, ["m1.start", ...staked]),
        voteDirect("m1.voteA", 0n, "investorA", true, ["m1.start", ...staked]),
        execute("m1.exec", 0n, ["m1.voteB", "m1.voteA"]),
        start("m2.start", 1n, ["m1.exec"]),
        voteDirect("m2.voteB", 1n, "investorB", false, ["m2.start"]),
        voteDirect("m2.voteA", 1n, "investorA", true, ["m2.start"]),
        {
            project: "P1",
            key: "m2.freeze",
            role: "guardian",
            call: "MilestoneEscrow.freezeMilestones()  [up to 45 days]",
            needs: ["m2.voteB", "m2.voteA"],
            isDone: async () => {
                const escrow = await escrowAs(ctx, project, "guardian");
                return (await escrow.freezeStart()) !== 0n || (await escrow.totalFrozen()) !== 0n;
            },
            simulate: async () => (await escrowAs(ctx, project, "guardian")).freezeMilestones.staticCall(),
            send: async () => (await escrowAs(ctx, project, "guardian")).freezeMilestones(),
        },
        {
            project: "P1",
            key: "m2.checkFrozen",
            role: "relayer",
            call: 'staticCall MilestoneEscrow.executeMilestone() must revert "Milestones frozen" (read-only, no transaction)',
            needs: ["m2.freeze"],
            check: async () => expectRevert(async () => (await escrowAs(ctx, project, "relayer")).executeMilestone.staticCall(), "Milestones frozen"),
        },
        {
            project: "P1",
            key: "m2.unfreeze",
            role: "guardian",
            call: "MilestoneEscrow.unfreezeMilestones()",
            needs: ["m2.checkFrozen"],
            isDone: async () => {
                const escrow = await escrowAs(ctx, project, "guardian");
                return (await escrow.freezeStart()) === 0n && (await escrow.totalFrozen()) !== 0n;
            },
            simulate: async () => (await escrowAs(ctx, project, "guardian")).unfreezeMilestones.staticCall(),
            send: async () => (await escrowAs(ctx, project, "guardian")).unfreezeMilestones(),
        },
        execute("m2.exec", 1n, ["m2.unfreeze"]),
        {
            project: "P1",
            key: "withdraw:investorB",
            role: "investorB",
            call: `DividendDistributor.withdraw(${formatTokens(P1_WITHDRAW_B)})  [after completion the vote lock is gone]`,
            needs: ["m2.exec", "pay"],
            isDone: async () => {
                const initialStake = stakeAmount(await shareOf(ctx, project, "investorB"), P1_STAKE_B_PERCENT);
                const current = await (await distributorAs(ctx, project, "investorB")).stakedBalance(ctx.addresses.investorB);
                return current > 0n && current <= initialStake - P1_WITHDRAW_B;
            },
            simulate: async () => (await distributorAs(ctx, project, "investorB")).withdraw.staticCall(P1_WITHDRAW_B),
            send: async () => (await distributorAs(ctx, project, "investorB")).withdraw(P1_WITHDRAW_B),
        },
    ];

    await runPlan(ctx, "Phase 6: vote, freeze, execute (P1)", steps);
}

runMain(main);
