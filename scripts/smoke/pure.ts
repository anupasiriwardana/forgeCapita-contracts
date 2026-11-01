// RUN BY THE USER ONLY (as part of the smoke-test scripts). This module is pure: it never connects to
// a network and never sends anything. It holds the constants, state-file validation, amount maths and
// EIP-712 type definitions shared by scripts/smoke/lib.ts and test/SmokeLib.ts.
//
// The smoke scripts are DRY-RUN by default. Nothing is sent unless the shell variable SMOKE_SEND=yes is
// set (see docs/smoke-test-v2.md). Only public addresses, tx hashes and amounts are ever printed or stored.
import { formatEther, type TypedDataField } from "ethers";

// ---------------------------------------------------------------------------------------------------
// Chains and public addresses (same on both chains, see docs/deployments-v2.md)
// ---------------------------------------------------------------------------------------------------
export const ALLOWED_CHAIN_IDS = [421614, 97] as const;
export type SmokeChainId = (typeof ALLOWED_CHAIN_IDS)[number];

export interface ChainInfo {
    readonly name: string;
    readonly explorer: string;
    readonly nativeSymbol: string;
}

export const CHAINS: Readonly<Record<SmokeChainId, ChainInfo>> = {
    421614: { name: "Arbitrum Sepolia", explorer: "https://sepolia.arbiscan.io", nativeSymbol: "ETH" },
    97: { name: "BSC Testnet", explorer: "https://testnet.bscscan.com", nativeSymbol: "tBNB" },
};

export const FACTORY_ADDRESS = "0x246Ffa3Bf583a15e92e17FAa32d3663C17204d52";
export const P2P_ADDRESS = "0xd2540297eB8FC0985b5fa26cba2358db0a0AE914";
export const REGISTRY_ADDRESS = "0x2e6A22fd249930b9F2905D1bD66443CbE366AacB";
// The relayer wallet (signer 5). If you use a throwaway relayer allow-listed with setRelayer, change this
// one constant (docs/smoke-test-v2.md, "Relayer wallet").
export const RELAYER_ADDRESS = "0x8a1Be9d8fd97658b6b0B8b537374FF6c3E41815b";
// Deployer = Guardian = treasury. Informational: the scripts compare signer 0 with registry.guardian().
export const GUARDIAN_ADDRESS = "0x08D3B18508ca976fECc7291c06c30ae15133eB4F";

export function isAllowedChainId(chainId: number): chainId is SmokeChainId {
    return (ALLOWED_CHAIN_IDS as readonly number[]).includes(chainId);
}

/** Throws unless the chain is Arbitrum Sepolia or BSC Testnet (also rejects the in-process hardhat network). */
export function assertAllowedChain(chainId: bigint | number): SmokeChainId {
    const id = Number(chainId);
    if (!isAllowedChainId(id)) {
        throw new Error(
            `Chain id ${id} is not allowed for the smoke test. Allowed: ${ALLOWED_CHAIN_IDS.join(", ")}. ` +
                "Run with --network arbitrumSepoliaSmoke or --network bscTestnetSmoke.",
        );
    }
    return id;
}

// ---------------------------------------------------------------------------------------------------
// Roles: signers[0..5]
// ---------------------------------------------------------------------------------------------------
export const ROLES = ["guardian", "developer", "investorA", "investorB", "buyer", "relayer"] as const;
export type Role = (typeof ROLES)[number];

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

export function isAddress(value: unknown): value is string {
    return typeof value === "string" && ADDRESS_PATTERN.test(value);
}

export function sameAddress(a: string, b: string): boolean {
    return a.toLowerCase() === b.toLowerCase();
}

/** Maps the six signer addresses (in order) to roles. Throws unless there are exactly six distinct addresses. */
export function mapRoles(addresses: readonly string[]): Record<Role, string> {
    if (addresses.length !== ROLES.length) {
        throw new Error(
            `Expected exactly ${ROLES.length} signers (${ROLES.join(", ")}) but the network has ${addresses.length}. ` +
                "Use the arbitrumSepoliaSmoke / bscTestnetSmoke networks from docs/smoke-test-v2.md.",
        );
    }
    const seen = new Set<string>();
    for (const address of addresses) {
        if (!isAddress(address)) throw new Error("A signer address is malformed.");
        const key = address.toLowerCase();
        if (seen.has(key)) throw new Error(`Signer ${address} appears more than once; all six roles need distinct wallets.`);
        seen.add(key);
    }
    return {
        guardian: addresses[0],
        developer: addresses[1],
        investorA: addresses[2],
        investorB: addresses[3],
        buyer: addresses[4],
        relayer: addresses[5],
    };
}

// ---------------------------------------------------------------------------------------------------
// Amounts (wei). Native currency: ETH on Arbitrum Sepolia, tBNB on BSC Testnet.
// ---------------------------------------------------------------------------------------------------
export const FINNEY = 10n ** 15n; // 0.001 native
export const ONE_TOKEN = 10n ** 18n;

export const TOTAL_SUPPLY_WHOLE = 1_000_000n;
export const PUBLIC_SUPPLY = (TOTAL_SUPPLY_WHOLE * ONE_TOKEN * 80n) / 100n;
export const MILESTONE_DESCRIPTIONS: readonly string[] = ["MVP", "Launch"];
export const MILESTONE_PERCENTAGES: readonly bigint[] = [50n, 50n];
export const FUNDING_DURATION_DAYS = 1n;

/** Refuse any single transaction value at or above this (the planned maximum is 0.03). */
export const MAX_TX_VALUE = 50n * FINNEY;

export const P1_GOAL = 40n * FINNEY; // 0.04
export const P1_INVEST_A = 30n * FINNEY; // 0.03
export const P1_INVEST_B = 20n * FINNEY; // 0.02
export const P2_GOAL = 4n * FINNEY; // 0.004
export const P2_INVEST_B = 4n * FINNEY;
export const P3_GOAL = 100n * FINNEY; // 0.1, never reached
export const P3_INVEST_B = 2n * FINNEY;

export const P1_STAKE_B_PERCENT = 60n; // share of B's claimed tokens that B stakes
export const LISTING_0_AMOUNT = 10_000n * ONE_TOKEN;
export const LISTING_0_PRICE = 5n * FINNEY; // 0.005
export const LISTING_1_AMOUNT = 5_000n * ONE_TOKEN;
export const LISTING_1_PRICE = 4n * FINNEY; // 0.004
export const P1_PAYMENT = 10n * FINNEY; // 0.01
export const P2_PAYMENT = 2n * FINNEY; // 0.002
export const P1_WITHDRAW_B = 32_000n * ONE_TOKEN;

export const P4_COST_MULTIPLIER = 22n;
/** Smallest raise (in caps) for which four capped actions stay under the ceiling: 1.05 + 15% of 19.95 = 4.0425 caps. */
export const P4_MIN_COST_MULTIPLIER = 21n;
/** Upper bound used by the funding estimate for P4 (22 x the largest default cap, 3.5e14). */
export const P4_RAISE_RESERVE = 22n * 350_000_000_000_000n;

export const PROJECT_KEYS = ["P1", "P2", "P3", "P4"] as const;
export type ProjectKey = (typeof PROJECT_KEYS)[number];

export interface ProjectPlan {
    readonly name: string;
    readonly symbol: string;
    readonly goalWei: bigint;
    readonly durationDays: bigint;
    readonly descriptions: readonly string[];
    readonly percentages: readonly bigint[];
}

/** P4's goal is dynamic (22 x maxCostPerAction), so it is passed in. */
export function projectPlan(key: ProjectKey, p4GoalWei?: bigint): ProjectPlan {
    switch (key) {
        case "P1":
            return plan("Smoke Alpha", "SMKA", P1_GOAL, MILESTONE_DESCRIPTIONS, MILESTONE_PERCENTAGES);
        case "P2":
            return plan("Smoke Beta", "SMKB", P2_GOAL, MILESTONE_DESCRIPTIONS, MILESTONE_PERCENTAGES);
        case "P3":
            return plan("Smoke Gamma", "SMKC", P3_GOAL, MILESTONE_DESCRIPTIONS, MILESTONE_PERCENTAGES);
        case "P4":
            if (p4GoalWei === undefined) throw new Error("P4 needs an explicit goal.");
            return plan("Smoke Delta", "SMKD", p4GoalWei, ["Delivery"], [100n]);
    }
}

function plan(
    name: string,
    symbol: string,
    goalWei: bigint,
    descriptions: readonly string[],
    percentages: readonly bigint[],
): ProjectPlan {
    return { name, symbol, goalWei, durationDays: FUNDING_DURATION_DAYS, descriptions, percentages };
}

/** Throws when a single transaction value reaches the per-transaction cap. */
export function assertTxValueWithinCap(value: bigint): void {
    if (value < 0n) throw new Error("Negative transaction value.");
    if (value >= MAX_TX_VALUE) {
        throw new Error(
            `Refusing a transaction value of ${formatNative(value)} (cap is below ${formatNative(MAX_TX_VALUE)}).`,
        );
    }
}

export function formatNative(wei: bigint): string {
    return formatEther(wei);
}

/** Whole-token display of an 18-decimal amount. */
export function formatTokens(amount: bigint): string {
    return formatEther(amount);
}

/** "1h 02m 03s" for a non-negative number of seconds. */
export function formatDuration(seconds: bigint): string {
    if (seconds < 0n) throw new Error("Negative duration.");
    const hours = seconds / 3600n;
    const minutes = (seconds % 3600n) / 60n;
    const rest = seconds % 60n;
    return `${hours}h ${minutes.toString().padStart(2, "0")}m ${rest.toString().padStart(2, "0")}s`;
}

/** One line about the time left in a funding window (chain time and deadline in seconds). */
export function fundingWindowLine(label: string, deadline: bigint, now: bigint): string {
    if (now > deadline) return `${label}: funding window CLOSED ${formatDuration(now - deadline)} ago (deadline ${deadline}); investing will revert`;
    return `${label}: funding window closes in ${formatDuration(deadline - now)} (deadline ${deadline})`;
}

/** token share = deposit * publicSupply / totalRaised (escrow._claimTokens). */
export function tokenShare(deposit: bigint, publicSupply: bigint, totalRaised: bigint): bigint {
    if (totalRaised === 0n) throw new Error("Funding is not closed yet (totalRaised is 0).");
    return (deposit * publicSupply) / totalRaised;
}

/** 5% platform fee taken at close (escrow.PLATFORM_FEE_PERCENT). */
export function platformFee(totalRaised: bigint): bigint {
    return (totalRaised * 5n) / 100n;
}

export interface RouteSplit {
    readonly treasury: bigint;
    readonly creator: bigint;
    readonly investors: bigint;
}

/** RevenueRouter.routePayment split: 1% treasury, 24% creator, remainder (75%) investors. */
export function routeSplit(amount: bigint): RouteSplit {
    const treasury = (amount * 1n) / 100n;
    const creator = (amount * 24n) / 100n;
    return { treasury, creator, investors: amount - creator - treasury };
}

/** P2PExchange fee: price * 100 / 10000. */
export function p2pFee(price: bigint): bigint {
    return (price * 100n) / 10_000n;
}

/** Portion of a token balance to stake: percent of the balance, rounded down. */
export function stakeAmount(balance: bigint, percent: bigint): bigint {
    return (balance * percent) / 100n;
}

/** SMOKE_RAISE_WEI: digits only, positive, below the per-transaction cap. Returns undefined when unset. */
export function parseRaiseOverride(raw: string | undefined): bigint | undefined {
    if (raw === undefined || raw === "") return undefined;
    if (!/^[0-9]{1,30}$/.test(raw)) throw new Error("SMOKE_RAISE_WEI must be a whole number of wei.");
    const value = BigInt(raw);
    if (value <= 0n) throw new Error("SMOKE_RAISE_WEI must be positive.");
    assertTxValueWithinCap(value);
    return value;
}

/** P4 raise (also its goal): 22 x registry.maxCostPerAction unless overridden. Always below the value cap. */
export function p4RaiseWei(maxCostPerAction: bigint, override?: bigint): bigint {
    if (override !== undefined) {
        assertTxValueWithinCap(override);
        const minimum = P4_MIN_COST_MULTIPLIER * maxCostPerAction;
        if (override < minimum) {
            throw new Error(
                `SMOKE_RAISE_WEI ${override} is below ${P4_MIN_COST_MULTIPLIER} x maxCostPerAction (${minimum}); ` +
                    "four sponsored actions could then trip \"Gas ceiling exceeded\". Use a larger value or unset it.",
            );
        }
        return override;
    }
    if (maxCostPerAction <= 0n) {
        throw new Error("registry.maxCostPerAction() is 0; set it (CON-04.3a) or pass SMOKE_RAISE_WEI.");
    }
    const raise = P4_COST_MULTIPLIER * maxCostPerAction;
    assertTxValueWithinCap(raise);
    return raise;
}

/** Gas budget (5% fee) and ceiling (budget + 15% of net funds) of a project that raised `raise`. */
export function gasLimits(raise: bigint): { budget: bigint; ceiling: bigint } {
    const budget = platformFee(raise);
    const netFunds = raise - budget;
    return { budget, ceiling: budget + (netFunds * 1500n) / 10_000n };
}

// ---------------------------------------------------------------------------------------------------
// Funding estimate (value outlay per role over the whole run, excluding gas)
// ---------------------------------------------------------------------------------------------------
export function valueOutlay(role: Role): bigint {
    switch (role) {
        case "investorA":
            return P1_INVEST_A + P4_RAISE_RESERVE;
        case "investorB":
            return P1_INVEST_B + P2_INVEST_B + P3_INVEST_B;
        case "buyer":
            return LISTING_0_PRICE + P1_PAYMENT + P2_PAYMENT;
        default:
            return 0n;
    }
}

// ---------------------------------------------------------------------------------------------------
// EIP-712 type definitions
// ---------------------------------------------------------------------------------------------------
export const ESCROW_EIP712_NAME = "ForgeCapita MilestoneEscrow";
export const ESCROW_EIP712_VERSION = "1";

export const VOTE_TYPES: Record<string, TypedDataField[]> = {
    Vote: [
        { name: "voter", type: "address" },
        { name: "milestoneIndex", type: "uint256" },
        { name: "support", type: "bool" },
        { name: "deadline", type: "uint256" },
    ],
};

export const PERMIT_TYPES: Record<string, TypedDataField[]> = {
    Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
    ],
};

// ---------------------------------------------------------------------------------------------------
// Resumable state file (public data only)
// ---------------------------------------------------------------------------------------------------
export interface StepRecord {
    done: boolean;
    txHash: string | null;
    block: number | null;
}

export interface ProjectParams {
    name: string;
    symbol: string;
    totalSupplyWhole: string;
    goalWei: string;
    durationDays: number;
    milestonePercentages: number[];
    fundingDeadline: string;
}

export interface ProjectRecord {
    token: string;
    escrow: string;
    distributor: string;
    router: string;
    params: ProjectParams;
    steps: Record<string, StepRecord>;
    /** Small public values produced by steps, for example P2P listing ids. */
    data: Record<string, string>;
}

/**
 * A transaction that was broadcast but whose receipt was not yet processed. Written BEFORE waiting for the
 * receipt so a crash or RPC timeout can never lead to a second send of the same step.
 *   "pending": the hash was recorded; look the receipt up on the next run.
 *   "failed":  the receipt showed status 0; the step may be retried (the hash is kept for the record).
 */
export interface PendingTx {
    txHash: string;
    status: "pending" | "failed";
}

export interface SmokeState {
    version: 1;
    chainId: number;
    wallets: Record<Role, string>;
    projects: Partial<Record<ProjectKey, ProjectRecord>>;
    /** Keyed "<project>/<step key>" (see pendingKey). Kept at the top level because `launch` has no project record yet. */
    pending: Record<string, PendingTx>;
}

export function emptyState(chainId: number, wallets: Record<Role, string>): SmokeState {
    return { version: 1, chainId, wallets: { ...wallets }, projects: {}, pending: {} };
}

export function pendingKey(project: ProjectKey, step: string): string {
    return `${project}/${step}`;
}

/** Records a broadcast tx hash for a step (call right after the send, before waiting for the receipt). */
export function recordPending(state: SmokeState, project: ProjectKey, step: string, txHash: string): void {
    if (!TX_HASH_PATTERN.test(txHash)) throw new Error("Refusing to record a malformed tx hash.");
    state.pending[pendingKey(project, step)] = { txHash, status: "pending" };
}

export function getPending(state: SmokeState, project: ProjectKey, step: string): PendingTx | undefined {
    return state.pending[pendingKey(project, step)];
}

export type PendingOutcome = "done" | "failed" | "wait";

/** Maps a receipt lookup to what the runner must do: null (not mined yet) waits, status 1 is done, status 0 failed. */
export function classifyReceipt(receipt: { status: number | null } | null): PendingOutcome {
    if (receipt === null) return "wait";
    if (receipt.status === 1) return "done";
    if (receipt.status === 0) return "failed";
    throw new Error("The receipt has no status field; check the transaction on the explorer.");
}

/** done removes the pending record, failed keeps the hash but allows a retry, wait changes nothing. */
export function applyPendingOutcome(state: SmokeState, project: ProjectKey, step: string, outcome: PendingOutcome): void {
    const key = pendingKey(project, step);
    const entry = state.pending[key];
    if (entry === undefined || outcome === "wait") return;
    if (outcome === "done") delete state.pending[key];
    else state.pending[key] = { txHash: entry.txHash, status: "failed" };
}

/** True while a recorded tx still blocks the step from being sent again. */
export function isBlockedByPending(state: SmokeState, project: ProjectKey, step: string): boolean {
    return getPending(state, project, step)?.status === "pending";
}

export interface LaunchFacts {
    readonly name: string;
    readonly symbol: string;
    readonly goalWei: bigint;
    readonly fundingDeadline: bigint;
}

/** True when an existing on-chain project looks like the one `plan` would launch and is still inside its funding window. */
export function launchMatchesPlan(facts: LaunchFacts, plan: ProjectPlan, now: bigint): boolean {
    return (
        facts.name === plan.name && facts.symbol === plan.symbol && facts.goalWei === plan.goalWei && facts.fundingDeadline > now
    );
}

export interface ListingFacts {
    readonly seller: string;
    readonly tokenAddress: string;
    readonly tokenAmount: bigint;
    readonly priceInETH: bigint;
}

/** True when a P2P listing is the one the step would create. */
export function listingMatches(listing: ListingFacts, seller: string, token: string, amount: bigint, price: bigint): boolean {
    return (
        sameAddress(listing.seller, seller) &&
        sameAddress(listing.tokenAddress, token) &&
        listing.tokenAmount === amount &&
        listing.priceInETH === price
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(path: string, why: string): never {
    throw new Error(`Invalid smoke state file at ${path}: ${why}`);
}

function readAddress(source: Record<string, unknown>, field: string, path: string): string {
    const value = source[field];
    if (!isAddress(value)) fail(`${path}.${field}`, "expected an address");
    return value;
}

function readDecimalString(source: Record<string, unknown>, field: string, path: string): string {
    const value = source[field];
    if (typeof value !== "string" || !/^[0-9]{1,78}$/.test(value)) fail(`${path}.${field}`, "expected a decimal string");
    return value;
}

function readStep(value: unknown, path: string): StepRecord {
    if (!isRecord(value)) fail(path, "expected an object");
    const { done, txHash, block } = value;
    if (typeof done !== "boolean") fail(`${path}.done`, "expected a boolean");
    if (txHash !== null && !(typeof txHash === "string" && TX_HASH_PATTERN.test(txHash))) {
        fail(`${path}.txHash`, "expected a tx hash or null");
    }
    if (block !== null && !(typeof block === "number" && Number.isSafeInteger(block) && block >= 0)) {
        fail(`${path}.block`, "expected a block number or null");
    }
    return { done, txHash, block };
}

function readParams(value: unknown, path: string): ProjectParams {
    if (!isRecord(value)) fail(path, "expected an object");
    const { name, symbol, durationDays, milestonePercentages } = value;
    if (typeof name !== "string" || name.length === 0 || name.length > 64) fail(`${path}.name`, "expected a short string");
    if (typeof symbol !== "string" || symbol.length === 0 || symbol.length > 16) fail(`${path}.symbol`, "expected a short string");
    if (typeof durationDays !== "number" || !Number.isSafeInteger(durationDays) || durationDays < 0) {
        fail(`${path}.durationDays`, "expected a non-negative integer");
    }
    if (
        !Array.isArray(milestonePercentages) ||
        milestonePercentages.length === 0 ||
        milestonePercentages.length > 5 ||
        !milestonePercentages.every((p): p is number => typeof p === "number" && Number.isSafeInteger(p) && p > 0)
    ) {
        fail(`${path}.milestonePercentages`, "expected 1 to 5 positive integers");
    }
    return {
        name,
        symbol,
        totalSupplyWhole: readDecimalString(value, "totalSupplyWhole", path),
        goalWei: readDecimalString(value, "goalWei", path),
        durationDays,
        milestonePercentages,
        fundingDeadline: readDecimalString(value, "fundingDeadline", path),
    };
}

function readPending(value: unknown, path: string): Record<string, PendingTx> {
    if (value === undefined) return {};
    if (!isRecord(value)) fail(path, "expected an object");
    const result: Record<string, PendingTx> = {};
    for (const [key, entry] of Object.entries(value)) {
        const [project, step, ...extra] = key.split("/");
        if (extra.length > 0 || !PROJECT_KEYS.some((candidate) => candidate === project) || !/^[A-Za-z0-9:._-]{1,64}$/.test(step ?? "")) {
            fail(`${path}.${key}`, "expected a key of the form <project>/<step>");
        }
        if (!isRecord(entry)) fail(`${path}.${key}`, "expected an object");
        const { txHash, status } = entry;
        if (typeof txHash !== "string" || !TX_HASH_PATTERN.test(txHash)) fail(`${path}.${key}.txHash`, "expected a tx hash");
        if (status !== "pending" && status !== "failed") fail(`${path}.${key}.status`, "expected pending or failed");
        result[key] = { txHash, status };
    }
    return result;
}

function readProject(value: unknown, path: string): ProjectRecord {
    if (!isRecord(value)) fail(path, "expected an object");
    const stepsRaw = value.steps;
    const dataRaw = value.data;
    if (!isRecord(stepsRaw)) fail(`${path}.steps`, "expected an object");
    if (!isRecord(dataRaw)) fail(`${path}.data`, "expected an object");
    const steps: Record<string, StepRecord> = {};
    for (const [key, step] of Object.entries(stepsRaw)) steps[key] = readStep(step, `${path}.steps.${key}`);
    const data: Record<string, string> = {};
    for (const [key, entry] of Object.entries(dataRaw)) {
        if (typeof entry !== "string" || entry.length > 128) fail(`${path}.data.${key}`, "expected a short string");
        data[key] = entry;
    }
    return {
        token: readAddress(value, "token", path),
        escrow: readAddress(value, "escrow", path),
        distributor: readAddress(value, "distributor", path),
        router: readAddress(value, "router", path),
        params: readParams(value.params, `${path}.params`),
        steps,
        data,
    };
}

/** Validates the shape of a parsed state file and returns it typed. Throws with the offending path. */
export function parseState(raw: unknown): SmokeState {
    if (!isRecord(raw)) fail("$", "expected an object");
    if (raw.version !== 1) fail("$.version", "expected 1");
    const { chainId } = raw;
    if (typeof chainId !== "number" || !isAllowedChainId(chainId)) fail("$.chainId", "unsupported chain id");
    const walletsRaw = raw.wallets;
    const projectsRaw = raw.projects;
    if (!isRecord(walletsRaw)) fail("$.wallets", "expected an object");
    if (!isRecord(projectsRaw)) fail("$.projects", "expected an object");

    const wallets = {} as Record<Role, string>;
    for (const role of ROLES) wallets[role] = readAddress(walletsRaw, role, "$.wallets");

    const projects: Partial<Record<ProjectKey, ProjectRecord>> = {};
    for (const [key, value] of Object.entries(projectsRaw)) {
        const projectKey = PROJECT_KEYS.find((candidate) => candidate === key);
        if (projectKey === undefined) fail(`$.projects.${key}`, "unknown project key");
        projects[projectKey] = readProject(value, `$.projects.${key}`);
    }
    return { version: 1, chainId, wallets, projects, pending: readPending(raw.pending, "$.pending") };
}

export function isStepDone(state: SmokeState, project: ProjectKey, key: string): boolean {
    return state.projects[project]?.steps[key]?.done === true;
}

// ---------------------------------------------------------------------------------------------------
// Safe error text: never print RPC URLs or full provider error dumps
// ---------------------------------------------------------------------------------------------------
export function sanitizeError(error: unknown): string {
    let text = "unknown error";
    if (typeof error === "object" && error !== null) {
        const candidate = error as { reason?: unknown; shortMessage?: unknown; message?: unknown };
        if (typeof candidate.reason === "string" && candidate.reason.length > 0) text = candidate.reason;
        else if (typeof candidate.shortMessage === "string") text = candidate.shortMessage;
        else if (typeof candidate.message === "string") text = candidate.message;
    } else if (typeof error === "string") {
        text = error;
    }
    return text.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "<url>").slice(0, 300);
}
