// RUN BY THE USER ONLY. Phase 4: P2P exchange on P1 tokens.
//   B approves the exchange, creates listing A (10,000 tokens for 0.005) and listing B (5,000 tokens for 0.004);
//   the buyer fills listing A (1% fee to the treasury); B cancels listing B.
// Listing ids come from the ListingCreated events and are stored in the state file (they are not necessarily
// 0 and 1 if the exchange was used before).
// DRY-RUN by default; set SMOKE_SEND=yes to send. Resumable via scripts/smoke/state/state-<chainId>.json.
//   npx hardhat run scripts/smoke/04-p2p.ts --network arbitrumSepoliaSmoke
import { connect, findExistingListing, findLogs, getData, log, p2pAs, requireProject, runMain, runPlan, tokenAs, type StepSpec } from "./lib.js";
import {
    LISTING_0_AMOUNT,
    LISTING_0_PRICE,
    LISTING_1_AMOUNT,
    LISTING_1_PRICE,
    P2P_ADDRESS,
    formatNative,
    formatTokens,
    p2pFee,
} from "./pure.js";

async function main(): Promise<void> {
    const ctx = await connect();
    const p1 = requireProject(ctx, "P1");
    if (p1 === undefined) {
        await runPlan(ctx, "Phase 4: P2P trading on P1", []);
        return;
    }
    const total = LISTING_0_AMOUNT + LISTING_1_AMOUNT;

    const createListing = (name: "listing0" | "listing1", amount: bigint, price: bigint): StepSpec => {
        return {
            project: "P1",
            key: `list:${name}`,
            role: "investorB",
            call: `P2PExchange.createListing(P1 token, ${formatTokens(amount)} tokens, price ${formatNative(price)})`,
            needs: ["p2p:approve"],
            isDone: async () => {
                const existing = await findExistingListing(ctx, p1, amount, price);
                if (existing === undefined) return false;
                p1.data[name] = existing;
                log(`    ${name} already exists on chain with id ${existing}`);
                return true;
            },
            simulate: async () => (await p2pAs(ctx, "investorB")).createListing.staticCall(p1.token, amount, price),
            send: async () => (await p2pAs(ctx, "investorB")).createListing(p1.token, amount, price),
            onDone: async (receipt) => {
                const exchange = await p2pAs(ctx, "investorB");
                const [created] = findLogs(receipt, exchange.interface, "ListingCreated", P2P_ADDRESS);
                if (created === undefined) throw new Error("ListingCreated was not found in the receipt.");
                const id = String(created.args.listingId);
                p1.data[name] = id;
                log(`    ${name} id ${id}`);
            },
        };
    };

    const steps: StepSpec[] = [
        {
            project: "P1",
            key: "p2p:approve",
            role: "investorB",
            call: `ProjectToken.approve(P2PExchange, ${formatTokens(total)})`,
            needs: ["claim:investorB"],
            isDone: async () => {
                const allowance = await (await tokenAs(ctx, p1, "investorB")).allowance(ctx.addresses.investorB, P2P_ADDRESS);
                return allowance >= total || p1.data.listing1 !== undefined;
            },
            simulate: async () => (await tokenAs(ctx, p1, "investorB")).approve.staticCall(P2P_ADDRESS, total),
            send: async () => (await tokenAs(ctx, p1, "investorB")).approve(P2P_ADDRESS, total),
        },
        createListing("listing0", LISTING_0_AMOUNT, LISTING_0_PRICE),
        createListing("listing1", LISTING_1_AMOUNT, LISTING_1_PRICE),
        {
            project: "P1",
            key: "fill:listing0",
            role: "buyer",
            call: `P2PExchange.fillListing(listing0)  [price ${formatNative(LISTING_0_PRICE)}, 1% fee ${formatNative(p2pFee(LISTING_0_PRICE))}]`,
            value: LISTING_0_PRICE,
            needs: ["list:listing0"],
            isDone: async () => {
                const id = p1.data.listing0;
                return id !== undefined && !(await (await p2pAs(ctx, "buyer")).listings(BigInt(id))).active;
            },
            simulate: async () => (await p2pAs(ctx, "buyer")).fillListing.staticCall(BigInt(getData(p1, "listing0")), { value: LISTING_0_PRICE }),
            send: async () => (await p2pAs(ctx, "buyer")).fillListing(BigInt(getData(p1, "listing0")), { value: LISTING_0_PRICE }),
        },
        {
            project: "P1",
            key: "cancel:listing1",
            role: "investorB",
            call: "P2PExchange.cancelListing(listing1)",
            needs: ["list:listing1"],
            isDone: async () => {
                const id = p1.data.listing1;
                return id !== undefined && !(await (await p2pAs(ctx, "investorB")).listings(BigInt(id))).active;
            },
            simulate: async () => (await p2pAs(ctx, "investorB")).cancelListing.staticCall(BigInt(getData(p1, "listing1"))),
            send: async () => (await p2pAs(ctx, "investorB")).cancelListing(BigInt(getData(p1, "listing1"))),
        },
    ];

    await runPlan(ctx, "Phase 4: P2P trading on P1", steps);
}

runMain(main);
