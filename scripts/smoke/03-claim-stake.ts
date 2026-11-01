// RUN BY THE USER ONLY. Phase 3: token claims and staking.
//   P1: A claimTokens (user-paid); B claimTokensFor by the RELAYER (books SponsoredGas action 0);
//       A stakeWithPermit by the RELAYER (A signs an ERC-2612 permit to the DISTRIBUTOR; SponsoredGas action 1);
//       B approve + stake 60% of its tokens (user-paid), keeping 40% unstaked for the P2P phase.
//   P2: B claimTokens (user-paid), no staking (zero-staker revenue scenario).
// DRY-RUN by default; set SMOKE_SEND=yes to send. Resumable via scripts/smoke/state/state-<chainId>.json.
//   npx hardhat run scripts/smoke/03-claim-stake.ts --network arbitrumSepoliaSmoke
import {
    connect,
    distributorAs,
    escrowAs,
    requireProject,
    runMain,
    runPlan,
    shareOf,
    signPermit,
    tokenAs,
    type SmokeContext,
    type StepSpec,
} from "./lib.js";
import { P1_STAKE_B_PERCENT, formatTokens, stakeAmount, type ProjectKey, type ProjectRecord, type Role } from "./pure.js";

async function shareLabel(ctx: SmokeContext, project: ProjectRecord, role: Role, percent = 100n): Promise<string> {
    try {
        return formatTokens(stakeAmount(await shareOf(ctx, project, role), percent));
    } catch {
        return "? (funding not closed yet)";
    }
}

function claimOwn(ctx: SmokeContext, key: ProjectKey, project: ProjectRecord, role: Role): StepSpec {
    return {
        project: key,
        key: `claim:${role}`,
        role,
        call: "MilestoneEscrow.claimTokens()",
        needs: ["close"],
        isDone: async () => (await escrowAs(ctx, project, role)).hasClaimedTokens(ctx.addresses[role]),
        simulate: async () => (await escrowAs(ctx, project, role)).claimTokens.staticCall(),
        send: async () => (await escrowAs(ctx, project, role)).claimTokens(),
    };
}

async function main(): Promise<void> {
    const ctx = await connect();
    const p1 = requireProject(ctx, "P1");
    const p2 = requireProject(ctx, "P2");

    const steps: StepSpec[] = [];
    if (p1 !== undefined) {
        const labelA = await shareLabel(ctx, p1, "investorA");
        const labelStakeB = await shareLabel(ctx, p1, "investorB", P1_STAKE_B_PERCENT);

        steps.push(claimOwn(ctx, "P1", p1, "investorA"));
        steps.push({
            project: "P1",
            key: "claim:investorB",
            role: "relayer",
            call: `MilestoneEscrow.claimTokensFor(${ctx.addresses.investorB})  [sponsored, tokens go to B]`,
            needs: ["close"],
            isDone: async () => (await escrowAs(ctx, p1, "relayer")).hasClaimedTokens(ctx.addresses.investorB),
            simulate: async () => (await escrowAs(ctx, p1, "relayer")).claimTokensFor.staticCall(ctx.addresses.investorB),
            send: async () => (await escrowAs(ctx, p1, "relayer")).claimTokensFor(ctx.addresses.investorB),
        });
        steps.push({
            project: "P1",
            key: "stake:investorA",
            role: "relayer",
            call: `DividendDistributor.stakeWithPermit(owner=A, amount=${labelA}, deadline, v, r, s)  [A signs the permit, spender = distributor]`,
            needs: ["claim:investorA"],
            isDone: async () => (await (await distributorAs(ctx, p1, "relayer")).stakedBalance(ctx.addresses.investorA)) > 0n,
            simulate: async () => {
                const amount = await shareOf(ctx, p1, "investorA");
                const permit = await signPermit(ctx, p1, "investorA", amount);
                return (await distributorAs(ctx, p1, "relayer")).stakeWithPermit.staticCall(
                    ctx.addresses.investorA,
                    amount,
                    permit.deadline,
                    permit.v,
                    permit.r,
                    permit.s,
                );
            },
            send: async () => {
                const amount = await shareOf(ctx, p1, "investorA");
                const permit = await signPermit(ctx, p1, "investorA", amount);
                return (await distributorAs(ctx, p1, "relayer")).stakeWithPermit(
                    ctx.addresses.investorA,
                    amount,
                    permit.deadline,
                    permit.v,
                    permit.r,
                    permit.s,
                );
            },
        });
        steps.push({
            project: "P1",
            key: "approve:investorB",
            role: "investorB",
            call: `ProjectToken.approve(distributor, ${labelStakeB})`,
            needs: ["claim:investorB"],
            isDone: async () => {
                const amount = stakeAmount(await shareOf(ctx, p1, "investorB"), P1_STAKE_B_PERCENT);
                const staked = await (await distributorAs(ctx, p1, "investorB")).stakedBalance(ctx.addresses.investorB);
                const allowance = await (await tokenAs(ctx, p1, "investorB")).allowance(ctx.addresses.investorB, p1.distributor);
                return staked > 0n || allowance >= amount;
            },
            simulate: async () => {
                const amount = stakeAmount(await shareOf(ctx, p1, "investorB"), P1_STAKE_B_PERCENT);
                return (await tokenAs(ctx, p1, "investorB")).approve.staticCall(p1.distributor, amount);
            },
            send: async () => {
                const amount = stakeAmount(await shareOf(ctx, p1, "investorB"), P1_STAKE_B_PERCENT);
                return (await tokenAs(ctx, p1, "investorB")).approve(p1.distributor, amount);
            },
        });
        steps.push({
            project: "P1",
            key: "stake:investorB",
            role: "investorB",
            call: `DividendDistributor.stake(${labelStakeB})`,
            needs: ["approve:investorB"],
            isDone: async () => (await (await distributorAs(ctx, p1, "investorB")).stakedBalance(ctx.addresses.investorB)) > 0n,
            simulate: async () => {
                const amount = stakeAmount(await shareOf(ctx, p1, "investorB"), P1_STAKE_B_PERCENT);
                return (await distributorAs(ctx, p1, "investorB")).stake.staticCall(amount);
            },
            send: async () => {
                const amount = stakeAmount(await shareOf(ctx, p1, "investorB"), P1_STAKE_B_PERCENT);
                return (await distributorAs(ctx, p1, "investorB")).stake(amount);
            },
        });
    }
    if (p2 !== undefined) steps.push(claimOwn(ctx, "P2", p2, "investorB"));

    await runPlan(ctx, "Phase 3: claim and stake", steps);
}

runMain(main);
