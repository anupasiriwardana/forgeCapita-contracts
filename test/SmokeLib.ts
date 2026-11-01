import { expect } from "chai";
import { TypedDataEncoder, id } from "ethers";
import {
    LISTING_0_PRICE,
    MAX_TX_VALUE,
    P1_INVEST_A,
    P1_INVEST_B,
    PERMIT_TYPES,
    PUBLIC_SUPPLY,
    ONE_TOKEN,
    VOTE_TYPES,
    assertAllowedChain,
    applyPendingOutcome,
    assertTxValueWithinCap,
    classifyReceipt,
    emptyState,
    formatDuration,
    fundingWindowLine,
    gasLimits,
    getPending,
    isBlockedByPending,
    isStepDone,
    launchMatchesPlan,
    listingMatches,
    mapRoles,
    p2pFee,
    p4RaiseWei,
    parseRaiseOverride,
    parseState,
    pendingKey,
    platformFee,
    projectPlan,
    recordPending,
    routeSplit,
    sanitizeError,
    stakeAmount,
    tokenShare,
    type ProjectRecord,
    type SmokeState,
} from "../scripts/smoke/pure.js";

const ADDRESSES = [
    "0x0000000000000000000000000000000000000001",
    "0x0000000000000000000000000000000000000002",
    "0x0000000000000000000000000000000000000003",
    "0x0000000000000000000000000000000000000004",
    "0x0000000000000000000000000000000000000005",
    "0x0000000000000000000000000000000000000006",
];
const HASH = `0x${"ab".repeat(32)}`;

function sampleState(): SmokeState {
    const state = emptyState(421614, mapRoles(ADDRESSES));
    state.projects.P1 = {
        token: ADDRESSES[0],
        escrow: ADDRESSES[1],
        distributor: ADDRESSES[2],
        router: ADDRESSES[3],
        params: {
            name: "Smoke Alpha",
            symbol: "SMKA",
            totalSupplyWhole: "1000000",
            goalWei: "40000000000000000",
            durationDays: 1,
            milestonePercentages: [50, 50],
            fundingDeadline: "1700000000",
        },
        steps: { launch: { done: true, txHash: HASH, block: 12 }, "claim:investorA": { done: false, txHash: null, block: null } },
        data: { listing0: "0" },
    };
    return state;
}

function projectOne(state: SmokeState): ProjectRecord {
    const record = state.projects.P1;
    if (record === undefined) throw new Error("sample state has no P1");
    return record;
}

describe("smoke test helpers", () => {
    describe("chain whitelist and roles", () => {
        it("accepts only Arbitrum Sepolia and BSC Testnet", () => {
            expect(assertAllowedChain(421614n)).to.equal(421614);
            expect(assertAllowedChain(97)).to.equal(97);
            expect(() => assertAllowedChain(31337)).to.throw("not allowed");
            expect(() => assertAllowedChain(1)).to.throw("not allowed");
        });

        it("maps exactly six distinct signers to roles in order", () => {
            const roles = mapRoles(ADDRESSES);
            expect(roles.guardian).to.equal(ADDRESSES[0]);
            expect(roles.developer).to.equal(ADDRESSES[1]);
            expect(roles.investorA).to.equal(ADDRESSES[2]);
            expect(roles.investorB).to.equal(ADDRESSES[3]);
            expect(roles.buyer).to.equal(ADDRESSES[4]);
            expect(roles.relayer).to.equal(ADDRESSES[5]);
        });

        it("rejects the wrong signer count and duplicates", () => {
            expect(() => mapRoles(ADDRESSES.slice(0, 5))).to.throw("exactly 6");
            expect(() => mapRoles([...ADDRESSES.slice(0, 5), ADDRESSES[0].toUpperCase().replace("0X", "0x")])).to.throw("more than once");
            expect(() => mapRoles([...ADDRESSES.slice(0, 5), "not-an-address"])).to.throw("malformed");
        });
    });

    describe("state file validation", () => {
        it("round-trips a valid state", () => {
            const state = sampleState();
            expect(parseState(JSON.parse(JSON.stringify(state)) as unknown)).to.deep.equal(state);
        });

        it("rejects malformed shapes", () => {
            const base = JSON.parse(JSON.stringify(sampleState())) as Record<string, unknown>;
            expect(() => parseState(null)).to.throw("expected an object");
            expect(() => parseState({ ...base, version: 2 })).to.throw("$.version");
            expect(() => parseState({ ...base, chainId: 31337 })).to.throw("$.chainId");
            expect(() => parseState({ ...base, projects: { P9: {} } })).to.throw("unknown project key");
            expect(() => parseState({ ...base, wallets: { guardian: "0x1" } })).to.throw("$.wallets");

            const badHash = sampleState();
            projectOne(badHash).steps.launch.txHash = "0x1234";
            expect(() => parseState(JSON.parse(JSON.stringify(badHash)) as unknown)).to.throw("txHash");

            const badAddress = sampleState();
            projectOne(badAddress).escrow = "escrow";
            expect(() => parseState(JSON.parse(JSON.stringify(badAddress)) as unknown)).to.throw("escrow");
        });
    });

    describe("pending transaction records", () => {
        const OTHER_HASH = `0x${"cd".repeat(32)}`;

        function roundTrip(state: SmokeState): SmokeState {
            return parseState(JSON.parse(JSON.stringify(state)) as unknown);
        }

        it("accepts old state files without a pending map", () => {
            const raw = JSON.parse(JSON.stringify(sampleState())) as Record<string, unknown>;
            delete raw.pending;
            expect(parseState(raw).pending).to.deep.equal({});
        });

        it("records a pending hash before the receipt is known and survives a save/load", () => {
            const state = sampleState();
            recordPending(state, "P1", "pay", HASH);
            expect(getPending(state, "P1", "pay")).to.deep.equal({ txHash: HASH, status: "pending" });
            expect(isBlockedByPending(state, "P1", "pay")).to.equal(true);
            expect(isStepDone(state, "P1", "pay")).to.equal(false);
            expect(roundTrip(state).pending[pendingKey("P1", "pay")]).to.deep.equal({ txHash: HASH, status: "pending" });
        });

        it("tracks launch before a project record exists", () => {
            const state = emptyState(421614, mapRoles(ADDRESSES));
            recordPending(state, "P2", "launch", HASH);
            expect(roundTrip(state).pending["P2/launch"]?.txHash).to.equal(HASH);
        });

        it("classifies receipts: missing waits, status 1 is done, status 0 failed", () => {
            expect(classifyReceipt(null)).to.equal("wait");
            expect(classifyReceipt({ status: 1 })).to.equal("done");
            expect(classifyReceipt({ status: 0 })).to.equal("failed");
            expect(() => classifyReceipt({ status: null })).to.throw("no status");
        });

        it("pending -> done removes the record", () => {
            const state = sampleState();
            recordPending(state, "P1", "pay", HASH);
            applyPendingOutcome(state, "P1", "pay", "wait");
            expect(isBlockedByPending(state, "P1", "pay")).to.equal(true);
            applyPendingOutcome(state, "P1", "pay", "done");
            expect(getPending(state, "P1", "pay")).to.equal(undefined);
        });

        it("pending -> failed keeps the hash, stops blocking, and a retry overwrites it", () => {
            const state = sampleState();
            recordPending(state, "P1", "list:listing0", HASH);
            applyPendingOutcome(state, "P1", "list:listing0", "failed");
            expect(getPending(state, "P1", "list:listing0")).to.deep.equal({ txHash: HASH, status: "failed" });
            expect(isBlockedByPending(state, "P1", "list:listing0")).to.equal(false);
            expect(roundTrip(state).pending["P1/list:listing0"]?.status).to.equal("failed");
            recordPending(state, "P1", "list:listing0", OTHER_HASH);
            expect(getPending(state, "P1", "list:listing0")).to.deep.equal({ txHash: OTHER_HASH, status: "pending" });
        });

        it("ignores outcomes for steps without a record", () => {
            const state = sampleState();
            applyPendingOutcome(state, "P1", "pay", "failed");
            expect(state.pending).to.deep.equal({});
        });

        it("refuses to record a malformed hash", () => {
            expect(() => recordPending(sampleState(), "P1", "pay", "0x1234")).to.throw("malformed");
        });

        it("rejects malformed pending records when parsing", () => {
            const base = JSON.parse(JSON.stringify(sampleState())) as Record<string, unknown>;
            const withPending = (pending: unknown): unknown => ({ ...base, pending });
            expect(() => parseState(withPending([]))).to.throw("$.pending");
            expect(() => parseState(withPending({ "P9/pay": { txHash: HASH, status: "pending" } }))).to.throw("<project>/<step>");
            expect(() => parseState(withPending({ "P1/a/b": { txHash: HASH, status: "pending" } }))).to.throw("<project>/<step>");
            expect(() => parseState(withPending({ "P1/": { txHash: HASH, status: "pending" } }))).to.throw("<project>/<step>");
            expect(() => parseState(withPending({ "P1/pay": "x" }))).to.throw("expected an object");
            expect(() => parseState(withPending({ "P1/pay": { txHash: "0x12", status: "pending" } }))).to.throw("txHash");
            expect(() => parseState(withPending({ "P1/pay": { txHash: HASH, status: "done" } }))).to.throw("status");
            expect(() => parseState(withPending({ "P1/pay": { txHash: HASH } }))).to.throw("status");
        });
    });

    describe("on-chain duplicate detection", () => {
        const plan = projectPlan("P1");
        const facts = { name: "Smoke Alpha", symbol: "SMKA", goalWei: plan.goalWei, fundingDeadline: 2_000n };

        it("matches a launched project by name, symbol, goal and open funding window", () => {
            expect(launchMatchesPlan(facts, plan, 1_000n)).to.equal(true);
            expect(launchMatchesPlan({ ...facts, name: "Other" }, plan, 1_000n)).to.equal(false);
            expect(launchMatchesPlan({ ...facts, symbol: "X" }, plan, 1_000n)).to.equal(false);
            expect(launchMatchesPlan({ ...facts, goalWei: 1n }, plan, 1_000n)).to.equal(false);
            expect(launchMatchesPlan(facts, plan, 2_000n)).to.equal(false);
        });

        it("matches a listing by seller, token, amount and price", () => {
            const listing = { seller: ADDRESSES[3], tokenAddress: ADDRESSES[0], tokenAmount: 5n, priceInETH: 7n };
            expect(listingMatches(listing, ADDRESSES[3], ADDRESSES[0], 5n, 7n)).to.equal(true);
            expect(listingMatches(listing, ADDRESSES[2], ADDRESSES[0], 5n, 7n)).to.equal(false);
            expect(listingMatches(listing, ADDRESSES[3], ADDRESSES[1], 5n, 7n)).to.equal(false);
            expect(listingMatches(listing, ADDRESSES[3], ADDRESSES[0], 6n, 7n)).to.equal(false);
            expect(listingMatches(listing, ADDRESSES[3], ADDRESSES[0], 5n, 8n)).to.equal(false);
        });

        it("describes the time left in a funding window", () => {
            expect(fundingWindowLine("P1", 4_000n, 100n)).to.contain("closes in 1h 05m 00s");
            expect(fundingWindowLine("P1", 100n, 4_000n)).to.contain("CLOSED");
        });
    });

    describe("amounts", () => {
        it("splits P1 tokens 60/40 between A and B", () => {
            const raised = P1_INVEST_A + P1_INVEST_B;
            expect(tokenShare(P1_INVEST_A, PUBLIC_SUPPLY, raised)).to.equal(480_000n * ONE_TOKEN);
            expect(tokenShare(P1_INVEST_B, PUBLIC_SUPPLY, raised)).to.equal(320_000n * ONE_TOKEN);
            expect(stakeAmount(320_000n * ONE_TOKEN, 60n)).to.equal(192_000n * ONE_TOKEN);
            expect(() => tokenShare(1n, PUBLIC_SUPPLY, 0n)).to.throw("not closed");
        });

        it("computes the 5% fee, the 1/24/75 revenue split and the 1% P2P fee", () => {
            expect(platformFee(P1_INVEST_A + P1_INVEST_B)).to.equal(2_500_000_000_000_000n);
            const split = routeSplit(10_000_000_000_000_000n);
            expect(split.treasury).to.equal(100_000_000_000_000n);
            expect(split.creator).to.equal(2_400_000_000_000_000n);
            expect(split.investors).to.equal(7_500_000_000_000_000n);
            expect(p2pFee(LISTING_0_PRICE)).to.equal(50_000_000_000_000n);
        });

        it("computes the P4 raise as 22 x maxCostPerAction and enforces the cap", () => {
            expect(p4RaiseWei(200_000_000_000_000n)).to.equal(4_400_000_000_000_000n);
            expect(p4RaiseWei(350_000_000_000_000n)).to.equal(7_700_000_000_000_000n);
            expect(p4RaiseWei(200_000_000_000_000n, 4_200_000_000_000_000n)).to.equal(4_200_000_000_000_000n);
            expect(() => p4RaiseWei(200_000_000_000_000n, 4_199_999_999_999_999n)).to.throw("21 x maxCostPerAction");
            expect(() => p4RaiseWei(0n)).to.throw("maxCostPerAction");
            expect(() => p4RaiseWei(MAX_TX_VALUE)).to.throw("Refusing");
            expect(() => p4RaiseWei(1n, MAX_TX_VALUE)).to.throw("Refusing");
        });

        it("keeps four capped actions under the P4 ceiling but above its budget", () => {
            const cap = 200_000_000_000_000n;
            const limits = gasLimits(p4RaiseWei(cap));
            expect(limits.budget).to.equal(220_000_000_000_000n);
            expect(limits.ceiling).to.be.greaterThan(4n * cap);
            expect(limits.budget).to.be.lessThan(4n * cap);
        });

        it("parses SMOKE_RAISE_WEI strictly", () => {
            expect(parseRaiseOverride(undefined)).to.equal(undefined);
            expect(parseRaiseOverride("")).to.equal(undefined);
            expect(parseRaiseOverride("1000")).to.equal(1000n);
            expect(() => parseRaiseOverride("1e18")).to.throw("whole number");
            expect(() => parseRaiseOverride("0")).to.throw("positive");
            expect(() => parseRaiseOverride(MAX_TX_VALUE.toString())).to.throw("Refusing");
        });

        it("caps single transaction values below 0.05 native", () => {
            expect(() => assertTxValueWithinCap(30_000_000_000_000_000n)).not.to.throw();
            expect(() => assertTxValueWithinCap(MAX_TX_VALUE)).to.throw("Refusing");
            expect(() => assertTxValueWithinCap(-1n)).to.throw("Negative");
        });

        it("formats durations", () => {
            expect(formatDuration(3723n)).to.equal("1h 02m 03s");
        });
    });

    describe("EIP-712 definitions", () => {
        it("matches the escrow Vote type string", () => {
            const solidity = "Vote(address voter,uint256 milestoneIndex,bool support,uint256 deadline)";
            expect(TypedDataEncoder.from(VOTE_TYPES).encodeType("Vote")).to.equal(solidity);
            expect(id(TypedDataEncoder.from(VOTE_TYPES).encodeType("Vote"))).to.equal(id(solidity));
        });

        it("matches the ERC-2612 Permit type string", () => {
            const solidity = "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)";
            expect(TypedDataEncoder.from(PERMIT_TYPES).encodeType("Permit")).to.equal(solidity);
        });
    });

    describe("error text", () => {
        it("never leaks URLs", () => {
            const error = Object.assign(new Error("boom"), { shortMessage: "request to https://example.invalid/key123 failed" });
            expect(sanitizeError(error)).to.equal("request to <url> failed");
            expect(sanitizeError(new Error("see http://rpc.invalid:8545/abc"))).to.equal("see <url>");
            expect(sanitizeError(Object.assign(new Error("x"), { reason: "Milestones frozen" }))).to.equal("Milestones frozen");
        });
    });
});
