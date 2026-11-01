// RUN BY THE USER ONLY. Phase 7: developer handover, cancel, refund and emergency shutdown on the throwaway P2.
//   developer proposeNewDeveloper(buyer); buyer acceptDeveloperRole; the new developer (buyer) claims the creator
//   funds (zero-staker fallback share from phase 5) and cancelProject("smoke test"); the Guardian claims the P2
//   treasury share; B approves the escrow and calls refundDeadProject; the Guardian runs emergencyShutdown
//   (allowed at once because every public token has been refunded; it burns the escrow's tokens).
// P1 is NOT shut down (destructive on a completed project) and is left as a COMPLETED reference project.
// DRY-RUN by default; set SMOKE_SEND=yes to send. Resumable via scripts/smoke/state/state-<chainId>.json.
//   npx hardhat run scripts/smoke/07-cancel-refund.ts --network arbitrumSepoliaSmoke
import { connect, escrowAs, requireProject, requireTreasuryIsGuardian, routerAs, runMain, runPlan, tokenAs, type StepSpec } from "./lib.js";
import { isStepDone, sameAddress } from "./pure.js";

async function main(): Promise<void> {
    const ctx = await connect();
    await requireTreasuryIsGuardian(ctx);
    const p2 = requireProject(ctx, "P2");
    if (p2 === undefined) {
        await runPlan(ctx, "Phase 7: handover, cancel, refund, shutdown (P2)", []);
        return;
    }
    const project = p2;
    const buyer = ctx.addresses.buyer;
    const paid = (): boolean => isStepDone(ctx.state, "P2", "pay");

    const steps: StepSpec[] = [
        {
            project: "P2",
            key: "propose",
            role: "developer",
            call: `MilestoneEscrow.proposeNewDeveloper(${buyer})  [buyer becomes the new developer]`,
            needs: ["close"],
            isDone: async () => {
                const escrow = await escrowAs(ctx, project, "developer");
                return sameAddress(await escrow.pendingDeveloper(), buyer) || sameAddress(await escrow.developer(), buyer);
            },
            simulate: async () => (await escrowAs(ctx, project, "developer")).proposeNewDeveloper.staticCall(buyer),
            send: async () => (await escrowAs(ctx, project, "developer")).proposeNewDeveloper(buyer),
        },
        {
            project: "P2",
            key: "accept",
            role: "buyer",
            call: "MilestoneEscrow.acceptDeveloperRole()",
            needs: ["propose"],
            isDone: async () => sameAddress(await (await escrowAs(ctx, project, "buyer")).developer(), buyer),
            simulate: async () => (await escrowAs(ctx, project, "buyer")).acceptDeveloperRole.staticCall(),
            send: async () => (await escrowAs(ctx, project, "buyer")).acceptDeveloperRole(),
        },
        {
            project: "P2",
            key: "claimCreator",
            role: "buyer",
            call: "RevenueRouter.claimCreatorFunds()  [as the NEW developer; claims the 24% + 75% zero-staker share]",
            needs: ["accept", "pay"],
            isDone: async () => paid() && (await (await routerAs(ctx, project, "buyer")).creatorPendingFunds()) === 0n,
            simulate: async () => (await routerAs(ctx, project, "buyer")).claimCreatorFunds.staticCall(),
            send: async () => (await routerAs(ctx, project, "buyer")).claimCreatorFunds(),
        },
        {
            project: "P2",
            key: "claimTreasury",
            role: "guardian",
            call: "RevenueRouter.claimTreasuryFunds()",
            needs: ["pay"],
            isDone: async () => paid() && (await (await routerAs(ctx, project, "guardian")).treasuryPendingFunds()) === 0n,
            simulate: async () => (await routerAs(ctx, project, "guardian")).claimTreasuryFunds.staticCall(),
            send: async () => (await routerAs(ctx, project, "guardian")).claimTreasuryFunds(),
        },
        {
            project: "P2",
            key: "cancel",
            role: "buyer",
            call: 'MilestoneEscrow.cancelProject("smoke test")  [as the new developer]',
            needs: ["accept"],
            isDone: async () => (await escrowAs(ctx, project, "buyer")).projectCancelled(),
            simulate: async () => (await escrowAs(ctx, project, "buyer")).cancelProject.staticCall("smoke test"),
            send: async () => (await escrowAs(ctx, project, "buyer")).cancelProject("smoke test"),
        },
        {
            project: "P2",
            key: "approveEscrow",
            role: "investorB",
            call: "ProjectToken.approve(escrow, all of B's tokens)  [refundDeadProject pulls them with transferFrom]",
            needs: ["cancel", "claim:investorB"],
            isDone: async () => {
                const token = await tokenAs(ctx, project, "investorB");
                const escrow = await escrowAs(ctx, project, "investorB");
                if ((await escrow.remainingPublicTokens()) === 0n) return true;
                const balance = await token.balanceOf(ctx.addresses.investorB);
                return balance > 0n && (await token.allowance(ctx.addresses.investorB, project.escrow)) >= balance;
            },
            simulate: async () => {
                const token = await tokenAs(ctx, project, "investorB");
                return token.approve.staticCall(project.escrow, await token.balanceOf(ctx.addresses.investorB));
            },
            send: async () => {
                const token = await tokenAs(ctx, project, "investorB");
                return token.approve(project.escrow, await token.balanceOf(ctx.addresses.investorB));
            },
        },
        {
            project: "P2",
            key: "refund",
            role: "investorB",
            call: "MilestoneEscrow.refundDeadProject()  [refund = tokens x escrow balance / remainingPublicTokens]",
            needs: ["approveEscrow"],
            isDone: async () => (await (await escrowAs(ctx, project, "investorB")).remainingPublicTokens()) === 0n,
            simulate: async () => (await escrowAs(ctx, project, "investorB")).refundDeadProject.staticCall(),
            send: async () => (await escrowAs(ctx, project, "investorB")).refundDeadProject(),
        },
        {
            project: "P2",
            key: "shutdown",
            role: "guardian",
            call: "MilestoneEscrow.emergencyShutdown()  [cancelled and fully refunded, so allowed immediately]",
            needs: ["refund"],
            isDone: async () => (await tokenAs(ctx, project, "guardian")).isInvalidated(),
            simulate: async () => (await escrowAs(ctx, project, "guardian")).emergencyShutdown.staticCall(),
            send: async () => (await escrowAs(ctx, project, "guardian")).emergencyShutdown(),
        },
    ];

    await runPlan(ctx, "Phase 7: handover, cancel, refund, shutdown (P2)", steps);
}

runMain(main);
