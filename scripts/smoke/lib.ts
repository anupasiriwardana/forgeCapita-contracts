// RUN BY THE USER ONLY (imported by the scripts/smoke/NN-*.ts phase scripts; it has no main of its own).
// The phase scripts send transactions from six wallets and must be run by the user with the
// arbitrumSepoliaSmoke or bscTestnetSmoke network from docs/smoke-test-v2.md. They are never run by Claude.
//
// DRY-RUN BY DEFAULT: nothing is sent unless the shell variable SMOKE_SEND=yes is set. In dry-run the
// plan is printed (who calls what, value, arguments), the balance preflight runs, and read-only
// staticCall / estimateGas simulations run only where the chain state allows them; otherwise the step
// prints "needs <step>". SMOKE_SEND and SMOKE_RAISE_WEI are the only environment variables read; neither
// is secret. Keys, RPC URLs and environment values are never printed or stored: the state file under
// scripts/smoke/state/ holds public addresses, parameters, tx hashes and block numbers only.
import { network } from "hardhat";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
    FeeData,
    Signature,
    isError,
    type Interface,
    type LogDescription,
    type TransactionReceipt,
    type TransactionResponse,
    type TypedDataDomain,
} from "ethers";
import type {
    DividendDistributor,
    ForgeCapitaFactory,
    ForgeCapitaRegistry,
    MilestoneEscrow,
    P2PExchange,
    ProjectToken,
    RevenueRouter,
} from "../../types/ethers-contracts/index.js";
import {
    CHAINS,
    ESCROW_EIP712_NAME,
    ESCROW_EIP712_VERSION,
    FACTORY_ADDRESS,
    GUARDIAN_ADDRESS,
    P2P_ADDRESS,
    PERMIT_TYPES,
    RELAYER_ADDRESS,
    REGISTRY_ADDRESS,
    ROLES,
    TOTAL_SUPPLY_WHOLE,
    VOTE_TYPES,
    assertAllowedChain,
    applyPendingOutcome,
    assertTxValueWithinCap,
    classifyReceipt,
    emptyState,
    formatNative,
    getPending,
    isStepDone,
    launchMatchesPlan,
    listingMatches,
    mapRoles,
    parseRaiseOverride,
    parseState,
    recordPending,
    sameAddress,
    sanitizeError,
    tokenShare,
    valueOutlay,
    type ChainInfo,
    type ProjectKey,
    type ProjectPlan,
    type ProjectRecord,
    type Role,
    type SmokeChainId,
    type SmokeState,
} from "./pure.js";

type SmokeNetwork = Awaited<ReturnType<typeof network.create>>;
export type HardhatEthers = SmokeNetwork["ethers"];
export type SmokeSigner = Awaited<ReturnType<HardhatEthers["getSigners"]>>[number];

const STATE_DIR = join(dirname(fileURLToPath(import.meta.url)), "state");

export interface SmokeContext {
    readonly ethers: HardhatEthers;
    readonly chainId: SmokeChainId;
    readonly chain: ChainInfo;
    readonly live: boolean;
    readonly signers: Record<Role, SmokeSigner>;
    readonly addresses: Record<Role, string>;
    readonly state: SmokeState;
    readonly statePath: string;
}

export interface CheckResult {
    readonly name: string;
    readonly ok: boolean;
    readonly detail: string;
}

export interface Connection {
    readonly ctx: SmokeContext | undefined;
    readonly checks: CheckResult[];
}

// ---------------------------------------------------------------------------------------------------
// Environment (the only two variables read)
// ---------------------------------------------------------------------------------------------------
export function sendEnabled(): boolean {
    return process.env.SMOKE_SEND === "yes";
}

export function raiseOverride(): bigint | undefined {
    return parseRaiseOverride(process.env.SMOKE_RAISE_WEI);
}

// ---------------------------------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------------------------------
export function log(message: string): void {
    console.log(message);
}

export function section(title: string): void {
    log(`\n=== ${title} ===`);
}

export function runMain(main: () => Promise<void>): void {
    main().catch((error: unknown) => {
        console.error(`ERROR: ${sanitizeError(error)}`);
        process.exitCode = 1;
    });
}

function shortAddress(address: string): string {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function txUrl(ctx: SmokeContext, hash: string): string {
    return `${ctx.chain.explorer}/tx/${hash}`;
}

export function addressUrl(ctx: SmokeContext, address: string): string {
    return `${ctx.chain.explorer}/address/${address}`;
}

// ---------------------------------------------------------------------------------------------------
// Connection and role checks
// ---------------------------------------------------------------------------------------------------
function pass(name: string, detail: string): CheckResult {
    return { name, ok: true, detail };
}

function failed(name: string, detail: string): CheckResult {
    return { name, ok: false, detail };
}

function statePathFor(chainId: number): string {
    return join(STATE_DIR, `state-${chainId}.json`);
}

function loadState(chainId: number, wallets: Record<Role, string>, path: string): { state: SmokeState; check: CheckResult } {
    if (!existsSync(path)) {
        return { state: emptyState(chainId, wallets), check: pass("state file", "none yet (fresh run)") };
    }
    const state = parseState(JSON.parse(readFileSync(path, "utf8")) as unknown);
    const sameChain = state.chainId === chainId;
    const sameWallets = ROLES.every((role) => sameAddress(state.wallets[role], wallets[role]));
    if (!sameChain || !sameWallets) {
        return {
            state: emptyState(chainId, wallets),
            check: failed("state file", "belongs to a different chain or wallet set; move it away to start a fresh run"),
        };
    }
    const launched = Object.keys(state.projects).join(", ") || "no projects";
    return { state, check: pass("state file", `resuming (${launched})`) };
}

/** Opens the network, applies the chain whitelist and runs every role/protocol check without throwing on a failed check. */
export async function openConnection(): Promise<Connection> {
    const { ethers } = await network.create();
    const chainId = assertAllowedChain((await ethers.provider.getNetwork()).chainId);
    const chain = CHAINS[chainId];
    const checks: CheckResult[] = [pass("chain id", `${chainId} (${chain.name})`)];

    if (chainId === 97) {
        const BSC_MIN_TIP = 100_000_000n; // 1e8 wei (0.1 gwei) BSC testnet minimum priority fee
        const originalGetFeeData = ethers.provider.getFeeData.bind(ethers.provider);
        ethers.provider.getFeeData = async () => {
            const fee = await originalGetFeeData();
            let maxPriorityFeePerGas = fee.maxPriorityFeePerGas;
            let maxFeePerGas = fee.maxFeePerGas;
            if (maxPriorityFeePerGas !== null && maxPriorityFeePerGas < BSC_MIN_TIP) {
                const diff = BSC_MIN_TIP - maxPriorityFeePerGas;
                maxPriorityFeePerGas = BSC_MIN_TIP;
                if (maxFeePerGas !== null) {
                    maxFeePerGas = maxFeePerGas + diff;
                }
            }
            return new FeeData(fee.gasPrice, maxFeePerGas, maxPriorityFeePerGas);
        };
    }

    const signerList = await ethers.getSigners();
    let addresses: Record<Role, string>;
    try {
        addresses = mapRoles(signerList.map((signer) => signer.address));
        checks.push(pass("six distinct signers", "guardian, developer, investorA, investorB, buyer, relayer"));
    } catch (error) {
        checks.push(failed("six distinct signers", sanitizeError(error)));
        return { ctx: undefined, checks };
    }
    const signers: Record<Role, SmokeSigner> = {
        guardian: signerList[0],
        developer: signerList[1],
        investorA: signerList[2],
        investorB: signerList[3],
        buyer: signerList[4],
        relayer: signerList[5],
    };

    for (const [name, address] of [
        ["registry", REGISTRY_ADDRESS],
        ["factory", FACTORY_ADDRESS],
        ["p2p exchange", P2P_ADDRESS],
    ] as const) {
        const code = await ethers.provider.getCode(address);
        checks.push(code !== "0x" ? pass(`${name} deployed`, address) : failed(`${name} deployed`, `no code at ${address}`));
    }

    const registry = await ethers.getContractAt("ForgeCapitaRegistry", REGISTRY_ADDRESS, signers.guardian);
    const factory = await ethers.getContractAt("ForgeCapitaFactory", FACTORY_ADDRESS, signers.guardian);

    const guardian = await registry.guardian();
    checks.push(
        sameAddress(guardian, addresses.guardian)
            ? pass("signer 0 is registry.guardian()", guardian)
            : failed("signer 0 is registry.guardian()", `registry guardian is ${guardian}, signer 0 is ${addresses.guardian}`),
    );
    if (!sameAddress(guardian, GUARDIAN_ADDRESS)) {
        checks.push(failed("guardian equals the documented deployer", `registry guardian is ${guardian}`));
    }
    checks.push(
        sameAddress(addresses.relayer, RELAYER_ADDRESS)
            ? pass("signer 5 equals the relayer constant", RELAYER_ADDRESS)
            : failed("signer 5 equals the relayer constant", `signer 5 is ${addresses.relayer}; change RELAYER_ADDRESS in pure.ts if intended`),
    );
    const allowed = await registry.isRelayer(addresses.relayer);
    checks.push(
        allowed ? pass("registry.isRelayer(relayer)", "true") : failed("registry.isRelayer(relayer)", "false: the relayer is not allow-listed"),
    );
    checks.push(
        sameAddress(await factory.registry(), REGISTRY_ADDRESS) && sameAddress(await factory.p2pExchange(), P2P_ADDRESS)
            ? pass("factory wiring", "registry and p2p exchange match")
            : failed("factory wiring", "factory.registry() / p2pExchange() differ from the constants"),
    );
    const maxCost = await registry.maxCostPerAction();
    checks.push(
        maxCost > 0n
            ? pass("registry.maxCostPerAction()", maxCost.toString())
            : failed("registry.maxCostPerAction()", "is 0; run CON-04.3a first"),
    );

    const statePath = statePathFor(chainId);
    const loaded = loadState(chainId, addresses, statePath);
    checks.push(loaded.check);

    const ctx: SmokeContext = {
        ethers,
        chainId,
        chain,
        live: sendEnabled(),
        signers,
        addresses,
        state: loaded.state,
        statePath,
    };
    return { ctx, checks };
}

/** Like openConnection but throws when any check fails; prints the banner and the public role table. */
export async function connect(): Promise<SmokeContext> {
    const { ctx, checks } = await openConnection();
    const problems = checks.filter((check) => !check.ok);
    if (problems.length > 0 || ctx === undefined) {
        for (const check of problems) log(`FAIL  ${check.name}: ${check.detail}`);
        throw new Error("Role/protocol checks failed; see the FAIL lines above. Nothing was sent.");
    }
    section(`${ctx.chain.name} (chain ${ctx.chainId})  mode: ${ctx.live ? "LIVE - transactions WILL be sent" : "DRY-RUN - nothing is sent (set SMOKE_SEND=yes to send)"}`);
    for (const role of ROLES) log(`  ${role.padEnd(10)} ${ctx.addresses[role]}`);
    return ctx;
}

// ---------------------------------------------------------------------------------------------------
// Contract accessors: always bound to the signer of a named role
// ---------------------------------------------------------------------------------------------------
export function factoryAs(ctx: SmokeContext, role: Role): Promise<ForgeCapitaFactory> {
    return ctx.ethers.getContractAt("ForgeCapitaFactory", FACTORY_ADDRESS, ctx.signers[role]);
}

export function registryAs(ctx: SmokeContext, role: Role): Promise<ForgeCapitaRegistry> {
    return ctx.ethers.getContractAt("ForgeCapitaRegistry", REGISTRY_ADDRESS, ctx.signers[role]);
}

export function p2pAs(ctx: SmokeContext, role: Role): Promise<P2PExchange> {
    return ctx.ethers.getContractAt("P2PExchange", P2P_ADDRESS, ctx.signers[role]);
}

export function escrowAs(ctx: SmokeContext, project: ProjectRecord, role: Role): Promise<MilestoneEscrow> {
    return ctx.ethers.getContractAt("MilestoneEscrow", project.escrow, ctx.signers[role]);
}

export function tokenAs(ctx: SmokeContext, project: ProjectRecord, role: Role): Promise<ProjectToken> {
    return ctx.ethers.getContractAt("ProjectToken", project.token, ctx.signers[role]);
}

export function distributorAs(ctx: SmokeContext, project: ProjectRecord, role: Role): Promise<DividendDistributor> {
    return ctx.ethers.getContractAt("DividendDistributor", project.distributor, ctx.signers[role]);
}

export function routerAs(ctx: SmokeContext, project: ProjectRecord, role: Role): Promise<RevenueRouter> {
    return ctx.ethers.getContractAt("RevenueRouter", project.router, ctx.signers[role]);
}

export async function chainNow(ctx: SmokeContext): Promise<bigint> {
    const block = await ctx.ethers.provider.getBlock("latest");
    if (block === null) throw new Error("Could not read the latest block.");
    return BigInt(block.timestamp);
}

/** registry.treasury() must be the Guardian wallet: the claimTreasuryFunds amounts in the plan assume it. */
export async function treasuryCheck(ctx: SmokeContext): Promise<CheckResult> {
    const registry = await registryAs(ctx, "guardian");
    const treasury = await registry.treasury();
    const name = "registry.treasury() is the Guardian wallet (signer 0)";
    return sameAddress(treasury, ctx.addresses.guardian)
        ? pass(name, treasury)
        : failed(name, `registry treasury is ${treasury}, signer 0 is ${ctx.addresses.guardian}; the treasury-claim steps would pay someone else`);
}

/** Live: refuses to continue when the treasury is not the Guardian. Dry-run: prints a warning. */
export async function requireTreasuryIsGuardian(ctx: SmokeContext): Promise<void> {
    const result = await treasuryCheck(ctx);
    if (result.ok) return;
    const message = `FAIL ${result.name}: ${result.detail}`;
    if (ctx.live) throw new Error(`${message}. Nothing was sent.`);
    log(`WARNING ${message}`);
    process.exitCode = 1;
}

// ---------------------------------------------------------------------------------------------------
// State file
// ---------------------------------------------------------------------------------------------------
export function saveState(ctx: SmokeContext): void {
    if (!ctx.live) return;
    mkdirSync(STATE_DIR, { recursive: true });
    const temp = `${ctx.statePath}.tmp`;
    writeFileSync(temp, `${JSON.stringify(ctx.state, null, 2)}\n`, "utf8");
    renameSync(temp, ctx.statePath);
}

/** Returns the project record, or undefined (dry-run, with a "needs" note). In live mode a missing project throws. */
export function requireProject(ctx: SmokeContext, key: ProjectKey): ProjectRecord | undefined {
    const record = ctx.state.projects[key];
    if (record !== undefined) return record;
    const message = `${key} is not launched yet (run the launch script first)`;
    if (ctx.live) throw new Error(message);
    log(`  needs ${message}`);
    return undefined;
}

export function getData(project: ProjectRecord, field: string): string {
    const value = project.data[field];
    if (value === undefined) throw new Error(`Step data "${field}" is missing; run the earlier step first.`);
    return value;
}

function markDone(ctx: SmokeContext, project: ProjectKey, key: string, receipt: TransactionReceipt | null, hash: string | null): void {
    const record = ctx.state.projects[project];
    if (record === undefined) throw new Error(`Cannot record step ${key}: ${project} has no state record.`);
    record.steps[key] = { done: true, txHash: hash, block: receipt === null ? null : receipt.blockNumber };
    applyPendingOutcome(ctx.state, project, key, "done");
    saveState(ctx);
}

// ---------------------------------------------------------------------------------------------------
// Plan runner
// ---------------------------------------------------------------------------------------------------
export interface StepSpec {
    readonly project: ProjectKey;
    readonly key: string;
    readonly role: Role;
    /** Human description of the call, with arguments. */
    readonly call: string;
    readonly value?: bigint;
    /** Gas units assumed for the balance reserve (default 400000). */
    readonly gas?: bigint;
    /** Earlier step keys of the same project; dry-run prints "needs ..." until they are recorded as done. */
    readonly needs?: readonly string[];
    /** On-chain fallback: true when the step's effect is already visible on chain. */
    readonly isDone?: () => Promise<boolean>;
    /** Run isDone even when the project has no state record yet (only `launch`, which creates the record). */
    readonly checkWithoutRecord?: boolean;
    /** Read-only staticCall / estimateGas of the write; throws on revert. */
    readonly simulate?: () => Promise<unknown>;
    /** The write. Exactly one of send / check must be set. */
    readonly send?: () => Promise<TransactionResponse>;
    /** A read-only assertion; returns a result line, throws on failure. */
    readonly check?: () => Promise<string>;
    readonly onDone?: (receipt: TransactionReceipt) => Promise<void>;
}

const DEFAULT_GAS_UNITS = 400_000n;
const L1_EXTRA_ARBITRUM = 100_000_000_000_000n; // 1e14 per tx, covers the L1 data fee

async function gasPrice(ctx: SmokeContext): Promise<bigint> {
    const fee = await ctx.ethers.provider.getFeeData();
    const price = fee.maxFeePerGas ?? fee.gasPrice;
    if (price === null) throw new Error("The RPC returned no gas price.");
    return price;
}

function reserveFor(ctx: SmokeContext, price: bigint, units: bigint): bigint {
    return units * price * 2n + (ctx.chainId === 421614 ? L1_EXTRA_ARBITRUM : 0n);
}

export interface BalanceRow {
    readonly role: Role;
    readonly address: string;
    readonly required: bigint;
    readonly balance: bigint;
}

async function reportBalances(ctx: SmokeContext, required: Map<Role, bigint>): Promise<BalanceRow[]> {
    const rows: BalanceRow[] = [];
    for (const role of ROLES) {
        const need = required.get(role) ?? 0n;
        if (need === 0n) continue;
        const balance = await ctx.ethers.provider.getBalance(ctx.addresses[role]);
        rows.push({ role, address: ctx.addresses[role], required: need, balance });
    }
    return rows;
}

/** Balance preflight for a set of pending steps. Throws in live mode on a shortfall; flags it in dry-run. */
async function preflight(ctx: SmokeContext, steps: readonly StepSpec[]): Promise<void> {
    if (steps.length === 0) return;
    const price = await gasPrice(ctx);
    const required = new Map<Role, bigint>();
    for (const step of steps) {
        const need = (step.value ?? 0n) + reserveFor(ctx, price, step.gas ?? DEFAULT_GAS_UNITS);
        required.set(step.role, (required.get(step.role) ?? 0n) + need);
    }
    const rows = await reportBalances(ctx, required);
    const short: string[] = [];
    log("Balance preflight (value + 2x gas reserve per transaction):");
    for (const row of rows) {
        const ok = row.balance >= row.required;
        log(`  ${ok ? "OK  " : "SHORT"} ${row.role.padEnd(10)} ${row.address} needs ${formatNative(row.required)} has ${formatNative(row.balance)} ${ctx.chain.nativeSymbol}`);
        if (!ok) short.push(`${row.role} ${row.address} needs ${formatNative(row.required)} but has ${formatNative(row.balance)}`);
    }
    if (short.length === 0) return;
    const message = `Insufficient balance: ${short.join("; ")}. Fund the wallet(s) (faucet) and re-run.`;
    if (ctx.live) throw new Error(message);
    log(`  PREFLIGHT FAIL (dry-run continues): ${message}`);
    process.exitCode = 1;
}

/** Whole-run funding estimate per role (value outlay + gas reserve). Used by 00-check. */
export async function fundingEstimate(ctx: SmokeContext): Promise<BalanceRow[]> {
    const price = await gasPrice(ctx);
    const txCounts: Record<Role, bigint> = { guardian: 8n, developer: 22n, investorA: 10n, investorB: 16n, buyer: 8n, relayer: 12n };
    const required = new Map<Role, bigint>();
    for (const role of ROLES) {
        const extraLaunchGas = role === "developer" ? 4n * 1_400_000n : 0n;
        const units = txCounts[role] * DEFAULT_GAS_UNITS + extraLaunchGas;
        const l1 = ctx.chainId === 421614 ? txCounts[role] * L1_EXTRA_ARBITRUM : 0n;
        required.set(role, valueOutlay(role) + units * price * 2n + l1);
    }
    return reportBalances(ctx, required);
}

function describeStep(step: StepSpec, ctx: SmokeContext): string {
    const value = step.value !== undefined && step.value > 0n ? ` value=${formatNative(step.value)}` : "";
    return `${step.role}(${shortAddress(ctx.addresses[step.role])}) -> ${step.call}${value}`;
}

function unmetNeeds(ctx: SmokeContext, step: StepSpec): string[] {
    return (step.needs ?? []).filter((need) => !isStepDone(ctx.state, step.project, need));
}

async function assertSameChain(ctx: SmokeContext): Promise<void> {
    const current = assertAllowedChain((await ctx.ethers.provider.getNetwork()).chainId);
    if (current !== ctx.chainId) throw new Error(`Chain id changed from ${ctx.chainId} to ${current}; aborting.`);
}

/** On-chain fallback for a missing state record. In dry-run an unreadable precondition just means "not done yet". */
async function alreadyDoneOnChain(ctx: SmokeContext, step: StepSpec): Promise<boolean> {
    if (step.isDone === undefined) return false;
    if (ctx.state.projects[step.project] === undefined && step.checkWithoutRecord !== true) return false;
    try {
        return await step.isDone();
    } catch (error) {
        if (ctx.live) throw error;
        return false;
    }
}

async function runStep(ctx: SmokeContext, step: StepSpec): Promise<void> {
    const tag = `[${step.project}] ${step.key}`;
    if (isStepDone(ctx.state, step.project, step.key)) {
        log(`${tag}  SKIP (done in state file)`);
        return;
    }
    if (step.value !== undefined) assertTxValueWithinCap(step.value);

    if (await settlePendingTx(ctx, step, tag)) return;

    if (await alreadyDoneOnChain(ctx, step)) {
        log(`${tag}  SKIP (already done on chain)`);
        markDone(ctx, step.project, step.key, null, null);
        return;
    }

    log(`${tag}  ${describeStep(step, ctx)}`);
    const unmet = unmetNeeds(ctx, step);

    if (!ctx.live) {
        if (unmet.length > 0) {
            log(`    needs ${unmet.join(", ")} first (not simulated)`);
            return;
        }
        await dryRunStep(step);
        return;
    }

    if (unmet.length > 0) throw new Error(`${tag} needs ${unmet.join(", ")} first.`);
    await assertSameChain(ctx);
    if (step.simulate !== undefined) await step.simulate();

    if (step.check !== undefined) {
        log(`    ${await step.check()}`);
        markDone(ctx, step.project, step.key, null, null);
        return;
    }
    if (step.send === undefined) throw new Error(`${tag} has neither send nor check.`);

    const response = await step.send();
    recordPending(ctx.state, step.project, step.key, response.hash);
    saveState(ctx);
    log(`    sent ${response.hash}  ${txUrl(ctx, response.hash)}`);
    const receipt = await response.wait();
    if (receipt === null || receipt.status !== 1) {
        applyPendingOutcome(ctx.state, step.project, step.key, "failed");
        saveState(ctx);
        throw new Error(`${tag} failed on chain (tx ${response.hash}). Check the explorer, then re-run to retry.`);
    }
    await finishStep(ctx, step, receipt, response.hash);
    log(`    confirmed in block ${receipt.blockNumber}`);
}

async function finishStep(ctx: SmokeContext, step: StepSpec, receipt: TransactionReceipt, hash: string): Promise<void> {
    if (step.onDone !== undefined) await step.onDone(receipt);
    markDone(ctx, step.project, step.key, receipt, hash);
}

/**
 * Resolves a tx hash recorded before a previous crash or timeout. Returns true when the step is finished (or must
 * not continue); false when it may be attempted again (no record, or the earlier tx failed on chain).
 * A tx that is not found yet stops a live run: nothing is ever resent while an earlier hash may still confirm.
 */
async function settlePendingTx(ctx: SmokeContext, step: StepSpec, tag: string): Promise<boolean> {
    const entry = getPending(ctx.state, step.project, step.key);
    if (entry === undefined || entry.status === "failed") return false;
    log(`${tag}  previous tx recorded: ${entry.txHash}  ${txUrl(ctx, entry.txHash)}`);
    const receipt = await ctx.ethers.provider.getTransactionReceipt(entry.txHash);
    const outcome = classifyReceipt(receipt);
    if (outcome === "wait" || receipt === null) {
        const message = `${tag}: previous tx ${entry.txHash} is still pending (no receipt yet). Wait for it to confirm or be dropped on the explorer, then re-run. Nothing was resent.`;
        if (ctx.live) throw new Error(message);
        log(`    ${message}`);
        return true;
    }
    if (!sameAddress(receipt.from, ctx.addresses[step.role])) {
        throw new Error(`${tag}: recorded tx ${entry.txHash} was not sent by the ${step.role} wallet; check the state file.`);
    }
    if (outcome === "failed") {
        applyPendingOutcome(ctx.state, step.project, step.key, "failed");
        saveState(ctx);
        log("    previous tx FAILED on chain (status 0); the step will be attempted again");
        return false;
    }
    await finishStep(ctx, step, receipt, entry.txHash);
    log(`    previous tx confirmed in block ${receipt.blockNumber}; step recorded as done (not resent)`);
    return true;
}

async function dryRunStep(step: StepSpec): Promise<void> {
    try {
        if (step.check !== undefined) {
            log(`    dry-run check: ${await step.check()}`);
        } else if (step.simulate !== undefined) {
            await step.simulate();
            log("    dry-run: simulation OK (nothing sent)");
        } else {
            log("    dry-run: no simulation available (nothing sent)");
        }
    } catch (error) {
        log(`    dry-run: WOULD FAIL: ${sanitizeError(error)}`);
    }
}

/** Runs the steps in order: balance preflight, then each step (skip done, simulate, send, record). */
export async function runPlan(ctx: SmokeContext, title: string, steps: readonly StepSpec[]): Promise<void> {
    section(`${title}  ${ctx.live ? "[LIVE]" : "[DRY-RUN]"}`);
    if (steps.length === 0) {
        log("Nothing to do in this phase yet.");
        return;
    }
    const pending = steps.filter((step) => !isStepDone(ctx.state, step.project, step.key));
    await preflight(ctx, pending);
    for (const step of steps) await runStep(ctx, step);
    log(ctx.live ? "\nPhase finished. State saved." : "\nDry-run finished. Re-run with SMOKE_SEND=yes to send.");
}

// ---------------------------------------------------------------------------------------------------
// Logs and signatures
// ---------------------------------------------------------------------------------------------------
export function findLogs(receipt: TransactionReceipt, iface: Interface, name: string, emitter: string): LogDescription[] {
    const found: LogDescription[] = [];
    for (const entry of receipt.logs) {
        if (!sameAddress(entry.address, emitter)) continue;
        const parsed = iface.parseLog({ topics: [...entry.topics], data: entry.data });
        if (parsed !== null && parsed.name === name) found.push(parsed);
    }
    return found;
}

export interface VoteSignature {
    readonly deadline: bigint;
    readonly signature: string;
}

/** EIP-712 Vote signed by the voter for the escrow's current milestone index. Domain read from the escrow. */
export async function signVote(ctx: SmokeContext, project: ProjectRecord, voter: Role, support: boolean): Promise<VoteSignature> {
    const escrow = await escrowAs(ctx, project, voter);
    const [domainInfo, milestoneIndex, now] = await Promise.all([escrow.eip712Domain(), escrow.currentMilestoneIndex(), chainNow(ctx)]);
    if (domainInfo.name !== ESCROW_EIP712_NAME || domainInfo.version !== ESCROW_EIP712_VERSION) {
        throw new Error("Escrow EIP-712 domain name/version differ from the expected values.");
    }
    if (Number(domainInfo.chainId) !== ctx.chainId || !sameAddress(domainInfo.verifyingContract, project.escrow)) {
        throw new Error("Escrow EIP-712 domain chain id / verifying contract do not match.");
    }
    const domain: TypedDataDomain = {
        name: domainInfo.name,
        version: domainInfo.version,
        chainId: domainInfo.chainId,
        verifyingContract: domainInfo.verifyingContract,
    };
    const deadline = now + 3600n;
    const signature = await ctx.signers[voter].signTypedData(domain, VOTE_TYPES, {
        voter: ctx.addresses[voter],
        milestoneIndex,
        support,
        deadline,
    });
    return { deadline, signature };
}

export interface PermitSignature {
    readonly deadline: bigint;
    readonly v: number;
    readonly r: string;
    readonly s: string;
}

/** ERC-2612 permit signed by `owner` with the DISTRIBUTOR as spender. Domain read from the token. */
export async function signPermit(ctx: SmokeContext, project: ProjectRecord, owner: Role, amount: bigint): Promise<PermitSignature> {
    const token = await tokenAs(ctx, project, owner);
    const [domainInfo, nonce, now] = await Promise.all([token.eip712Domain(), token.nonces(ctx.addresses[owner]), chainNow(ctx)]);
    if (Number(domainInfo.chainId) !== ctx.chainId || !sameAddress(domainInfo.verifyingContract, project.token)) {
        throw new Error("Token EIP-712 domain chain id / verifying contract do not match.");
    }
    const domain: TypedDataDomain = {
        name: domainInfo.name,
        version: domainInfo.version,
        chainId: domainInfo.chainId,
        verifyingContract: domainInfo.verifyingContract,
    };
    const deadline = now + 3600n;
    const signature = await ctx.signers[owner].signTypedData(domain, PERMIT_TYPES, {
        owner: ctx.addresses[owner],
        spender: project.distributor,
        value: amount,
        nonce,
        deadline,
    });
    const split = Signature.from(signature);
    return { deadline, v: split.v, r: split.r, s: split.s };
}

/** Passes when `attempt` reverts with a message containing `expected`; throws otherwise. */
export async function expectRevert(attempt: () => Promise<unknown>, expected: string): Promise<string> {
    try {
        await attempt();
    } catch (error) {
        const text = sanitizeError(error);
        if (text.includes(expected)) return `reverted as expected: "${expected}"`;
        throw new Error(`Reverted with an unexpected reason: ${text}`);
    }
    throw new Error(`Expected a revert containing "${expected}" but the call succeeded.`);
}

// ---------------------------------------------------------------------------------------------------
// Shared step builders
// ---------------------------------------------------------------------------------------------------
/** Tokens an investor receives for their deposit, from on-chain values. Throws while funding is still open. */
export async function shareOf(ctx: SmokeContext, project: ProjectRecord, role: Role): Promise<bigint> {
    const escrow = await escrowAs(ctx, project, role);
    const [deposit, supply, raised] = await Promise.all([escrow.deposits(ctx.addresses[role]), escrow.publicSupply(), escrow.totalRaised()]);
    return tokenShare(deposit, supply, raised);
}

function listOf(values: readonly (string | bigint)[]): string {
    return `[${values.map((value) => value.toString()).join(", ")}]`;
}

function projectRecordOf(
    plan: ProjectPlan,
    addresses: { token: string; escrow: string; distributor: string; router: string },
    deadline: bigint,
): ProjectRecord {
    return {
        ...addresses,
        params: {
            name: plan.name,
            symbol: plan.symbol,
            totalSupplyWhole: TOTAL_SUPPLY_WHOLE.toString(),
            goalWei: plan.goalWei.toString(),
            durationDays: Number(plan.durationDays),
            milestonePercentages: plan.percentages.map(Number),
            fundingDeadline: deadline.toString(),
        },
        steps: {},
        data: {},
    };
}

const MAX_DEVELOPER_PROJECTS = 256n;
const MAX_LAUNCH_CANDIDATES = 10;

/** Tokens the developer launched, oldest first. Stops at the first out-of-range revert; any other error is rethrown. */
async function developerTokens(ctx: SmokeContext): Promise<string[]> {
    const factory = await factoryAs(ctx, "developer");
    const tokens: string[] = [];
    for (let index = 0n; index < MAX_DEVELOPER_PROJECTS; index++) {
        try {
            tokens.push(await factory.developerProjects(ctx.addresses.developer, index));
        } catch (error) {
            if (isError(error, "CALL_EXCEPTION") || sanitizeError(error).includes("revert")) return tokens;
            throw error;
        }
    }
    throw new Error("The developer wallet has too many projects to scan; check the explorer manually.");
}

/**
 * On-chain fallback for `launch` when the state file has no record (crash before the pending hash was written, or a
 * lost state file). Looks for a project of this developer with the plan's name, symbol and goal that is still inside its
 * funding window and adopts it into the state. It cannot tell a project of an earlier run from this run's, so a fresh
 * run started within 24 hours of an old one adopts the old project (documented in docs/smoke-test-v2.md).
 */
async function adoptExistingLaunch(ctx: SmokeContext, key: ProjectKey, plan: ProjectPlan): Promise<boolean> {
    const known = Object.values(ctx.state.projects).map((record) => record.token.toLowerCase());
    const tokens = (await developerTokens(ctx)).slice(-MAX_LAUNCH_CANDIDATES).reverse();
    const now = await chainNow(ctx);
    for (const tokenAddress of tokens) {
        if (known.includes(tokenAddress.toLowerCase())) continue;
        const token = await ctx.ethers.getContractAt("ProjectToken", tokenAddress);
        const escrowAddress = await token.owner();
        const escrow = await ctx.ethers.getContractAt("MilestoneEscrow", escrowAddress);
        const [name, symbol, goalWei, fundingDeadline] = await Promise.all([
            token.name(),
            token.symbol(),
            escrow.fundingGoal(),
            escrow.fundingDeadline(),
        ]);
        if (!launchMatchesPlan({ name, symbol, goalWei, fundingDeadline }, plan, now)) continue;

        log(`    WARNING: a matching ${plan.name} project already exists on chain (token ${tokenAddress}); adopting it instead of launching again`);
        const factory = await factoryAs(ctx, "developer");
        let events;
        try {
            events = await factory.queryFilter(factory.filters.ProjectLaunched(ctx.addresses.developer));
        } catch (error) {
            throw new Error(
                `${plan.name} exists on chain (token ${tokenAddress}, escrow ${escrowAddress}) but its other addresses could not be read from logs (${sanitizeError(error)}). ` +
                    "Do not launch again: see 'Partial failure' in docs/smoke-test-v2.md.",
            );
        }
        const launched = events.find((event) => sameAddress(event.args.projectToken, tokenAddress));
        if (launched === undefined) {
            throw new Error(`${plan.name}: ProjectLaunched for token ${tokenAddress} was not found; check the explorer manually.`);
        }
        ctx.state.projects[key] = projectRecordOf(
            plan,
            {
                token: tokenAddress,
                escrow: escrowAddress,
                distributor: launched.args.dividendDistributor,
                router: launched.args.revenueRouter,
            },
            fundingDeadline,
        );
        return true;
    }
    return false;
}

/** P2P listing id already created with these exact terms by investor B for the project token (newest 50 listings). */
export async function findExistingListing(
    ctx: SmokeContext,
    project: ProjectRecord,
    amount: bigint,
    price: bigint,
): Promise<string | undefined> {
    const exchange = await p2pAs(ctx, "investorB");
    const next = await exchange.nextListingId();
    const lowest = next > 50n ? next - 50n : 0n;
    for (let id = next; id > lowest; id--) {
        const listingId = id - 1n;
        const listing = await exchange.listings(listingId);
        const facts = { seller: listing.seller, tokenAddress: listing.tokenAddress, tokenAmount: listing.tokenAmount, priceInETH: listing.priceInETH };
        if (listingMatches(facts, ctx.addresses.investorB, project.token, amount, price)) return listingId.toString();
    }
    return undefined;
}

/** Developer launches a project through the factory and records its four addresses in the state file. */
export function launchStep(ctx: SmokeContext, key: ProjectKey, plan: ProjectPlan): StepSpec {
    const args: [string, string, bigint, string[], bigint[], bigint, bigint] = [
        plan.name,
        plan.symbol,
        TOTAL_SUPPLY_WHOLE,
        [...plan.descriptions],
        [...plan.percentages],
        plan.goalWei,
        plan.durationDays,
    ];
    return {
        project: key,
        key: "launch",
        role: "developer",
        call:
            `ForgeCapitaFactory.launchProject("${plan.name}", "${plan.symbol}", ${TOTAL_SUPPLY_WHOLE}, ` +
            `${listOf(plan.descriptions)}, ${listOf(plan.percentages)}, goal=${formatNative(plan.goalWei)}, days=${plan.durationDays})`,
        gas: 1_800_000n,
        checkWithoutRecord: true,
        isDone: async () => {
            if (ctx.state.projects[key] !== undefined) return true;
            return adoptExistingLaunch(ctx, key, plan);
        },
        simulate: async () => {
            const factory = await factoryAs(ctx, "developer");
            return factory.launchProject.staticCall(...args);
        },
        send: async () => {
            const factory = await factoryAs(ctx, "developer");
            return factory.launchProject(...args);
        },
        onDone: async (receipt) => {
            const factory = await factoryAs(ctx, "developer");
            const [launched] = findLogs(receipt, factory.interface, "ProjectLaunched", FACTORY_ADDRESS);
            if (launched === undefined) throw new Error("ProjectLaunched was not found in the launch receipt.");
            const escrowAddress = String(launched.args.milestoneEscrow);
            const escrow = await ctx.ethers.getContractAt("MilestoneEscrow", escrowAddress);
            const deadline = await escrow.fundingDeadline();
            ctx.state.projects[key] = projectRecordOf(
                plan,
                {
                    token: String(launched.args.projectToken),
                    escrow: escrowAddress,
                    distributor: String(launched.args.dividendDistributor),
                    router: String(launched.args.revenueRouter),
                },
                deadline,
            );
            log(`    ${key} escrow ${escrowAddress}  ${addressUrl(ctx, escrowAddress)}`);
        },
    };
}

/** An investor sends native currency to the escrow's receive(). */
export function investStep(ctx: SmokeContext, key: ProjectKey, project: ProjectRecord, role: Role, amount: bigint): StepSpec {
    const stepKey = `invest:${role}`;
    return {
        project: key,
        key: stepKey,
        role,
        call: `native transfer to MilestoneEscrow ${project.escrow} (receive -> DepositReceived)`,
        value: amount,
        isDone: async () => {
            const escrow = await escrowAs(ctx, project, role);
            return (await escrow.deposits(ctx.addresses[role])) >= amount;
        },
        simulate: () => ctx.ethers.provider.estimateGas({ from: ctx.addresses[role], to: project.escrow, value: amount }),
        send: () => ctx.signers[role].sendTransaction({ to: project.escrow, value: amount }),
    };
}

/** Developer closes funding (5% fee to treasury sets the gas budget). */
export function closeStep(ctx: SmokeContext, key: ProjectKey, project: ProjectRecord, needs: readonly string[]): StepSpec {
    return {
        project: key,
        key: "close",
        role: "developer",
        call: "MilestoneEscrow.closeFundingAndStart()",
        needs,
        isDone: async () => !(await (await escrowAs(ctx, project, "developer")).isFundingActive()),
        simulate: async () => (await escrowAs(ctx, project, "developer")).closeFundingAndStart.staticCall(),
        send: async () => (await escrowAs(ctx, project, "developer")).closeFundingAndStart(),
    };
}
