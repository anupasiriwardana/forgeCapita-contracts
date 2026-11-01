// RUN BY THE USER ONLY. Phase 5: revenue routing.
//   P1 (stakers exist): the buyer pays 0.01 into the router (1% treasury, 24% creator, 75% to the distributor);
//       investor A claims yield (user-paid); the developer claims creator funds; the Guardian (treasury) claims
//       the treasury share.
//   P2 (nobody staked): the buyer pays 0.002; the 75% falls back to the creator's pending funds (claimed in phase 7).
// DRY-RUN by default; set SMOKE_SEND=yes to send. Resumable via scripts/smoke/state/state-<chainId>.json.
//   npx hardhat run scripts/smoke/05-revenue.ts --network arbitrumSepoliaSmoke
import { connect, distributorAs, requireProject, requireTreasuryIsGuardian, routerAs, runMain, runPlan, type StepSpec } from "./lib.js";
import { P1_PAYMENT, P2_PAYMENT, formatNative, isStepDone, routeSplit } from "./pure.js";

async function main(): Promise<void> {
    const ctx = await connect();
    await requireTreasuryIsGuardian(ctx);
    const p1 = requireProject(ctx, "P1");
    const p2 = requireProject(ctx, "P2");

    const steps: StepSpec[] = [];
    if (p1 !== undefined) {
        const split = routeSplit(P1_PAYMENT);
        const paid = (): boolean => isStepDone(ctx.state, "P1", "pay");
        steps.push(
            {
                project: "P1",
                key: "pay",
                role: "buyer",
                call:
                    `RevenueRouter.routePayment()  [treasury ${formatNative(split.treasury)}, creator ${formatNative(split.creator)}, ` +
                    `distributor ${formatNative(split.investors)}]`,
                value: P1_PAYMENT,
                needs: ["stake:investorA", "stake:investorB"],
                simulate: async () => (await routerAs(ctx, p1, "buyer")).routePayment.staticCall({ value: P1_PAYMENT }),
                send: async () => (await routerAs(ctx, p1, "buyer")).routePayment({ value: P1_PAYMENT }),
            },
            {
                project: "P1",
                key: "claimYield:investorA",
                role: "investorA",
                call: "DividendDistributor.claimYield()",
                needs: ["pay"],
                isDone: async () => paid() && (await (await distributorAs(ctx, p1, "investorA")).getClaimableYield(ctx.addresses.investorA)) === 0n,
                simulate: async () => (await distributorAs(ctx, p1, "investorA")).claimYield.staticCall(),
                send: async () => (await distributorAs(ctx, p1, "investorA")).claimYield(),
            },
            {
                project: "P1",
                key: "claimCreator",
                role: "developer",
                call: "RevenueRouter.claimCreatorFunds()",
                needs: ["pay"],
                isDone: async () => paid() && (await (await routerAs(ctx, p1, "developer")).creatorPendingFunds()) === 0n,
                simulate: async () => (await routerAs(ctx, p1, "developer")).claimCreatorFunds.staticCall(),
                send: async () => (await routerAs(ctx, p1, "developer")).claimCreatorFunds(),
            },
            {
                project: "P1",
                key: "claimTreasury",
                role: "guardian",
                call: "RevenueRouter.claimTreasuryFunds()  [pays registry.treasury(), which is the Guardian wallet]",
                needs: ["pay"],
                isDone: async () => paid() && (await (await routerAs(ctx, p1, "guardian")).treasuryPendingFunds()) === 0n,
                simulate: async () => (await routerAs(ctx, p1, "guardian")).claimTreasuryFunds.staticCall(),
                send: async () => (await routerAs(ctx, p1, "guardian")).claimTreasuryFunds(),
            },
        );
    }
    if (p2 !== undefined) {
        const split = routeSplit(P2_PAYMENT);
        steps.push({
            project: "P2",
            key: "pay",
            role: "buyer",
            call:
                `RevenueRouter.routePayment()  [zero stakers: creator pending gets ${formatNative(split.creator + split.investors)}, ` +
                `treasury ${formatNative(split.treasury)}]`,
            value: P2_PAYMENT,
            needs: ["claim:investorB"],
            simulate: async () => (await routerAs(ctx, p2, "buyer")).routePayment.staticCall({ value: P2_PAYMENT }),
            send: async () => (await routerAs(ctx, p2, "buyer")).routePayment({ value: P2_PAYMENT }),
        });
    }

    await runPlan(ctx, "Phase 5: revenue", steps);
}

runMain(main);
