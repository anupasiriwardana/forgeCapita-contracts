// RUN BY THE USER ONLY. Read-only preflight for the v2 testnet smoke test: it sends NOTHING in any mode
// (SMOKE_SEND has no effect here). It prints the six PUBLIC wallet addresses, their balances, PASS/FAIL
// lines for the role and protocol checks, and the computed funding shortfall per wallet.
//   npx hardhat run scripts/smoke/00-check.ts --network arbitrumSepoliaSmoke
//   npx hardhat run scripts/smoke/00-check.ts --network bscTestnetSmoke
import {
    addressUrl,
    fundingEstimate,
    log,
    openConnection,
    raiseOverride,
    registryAs,
    runMain,
    section,
    treasuryCheck,
} from "./lib.js";
import { ROLES, formatNative, p4RaiseWei } from "./pure.js";

async function main(): Promise<void> {
    const { ctx, checks } = await openConnection();
    if (ctx !== undefined) checks.push(await treasuryCheck(ctx));

    section("Checks");
    let allPassed = true;
    for (const check of checks) {
        log(`${check.ok ? "PASS" : "FAIL"}  ${check.name}: ${check.detail}`);
        if (!check.ok) allPassed = false;
    }
    if (ctx === undefined) {
        process.exitCode = 1;
        return;
    }

    section(`Wallets on ${ctx.chain.name} (public addresses only)`);
    for (const role of ROLES) log(`  ${role.padEnd(10)} ${ctx.addresses[role]}  ${addressUrl(ctx, ctx.addresses[role])}`);

    section("Funding (estimate for the whole run: value outlay + 2x gas reserve per transaction)");
    let anyShort = false;
    for (const row of await fundingEstimate(ctx)) {
        const shortfall = row.required > row.balance ? row.required - row.balance : 0n;
        if (shortfall > 0n) anyShort = true;
        log(
            `  ${shortfall > 0n ? "SHORT" : "OK   "} ${row.role.padEnd(10)} balance ${formatNative(row.balance)}  ` +
                `required ${formatNative(row.required)}  shortfall ${formatNative(shortfall)} ${ctx.chain.nativeSymbol}`,
        );
    }

    const registry = await registryAs(ctx, "guardian");
    const maxCost = await registry.maxCostPerAction();
    log(`\nP4 (optional gas-debt scenario) raise would be ${formatNative(p4RaiseWei(maxCost, raiseOverride()))} ${ctx.chain.nativeSymbol}`);

    if (anyShort) log("\nFund the SHORT wallets from a faucet, then run this check again.");
    log(allPassed && !anyShort ? "\nAll checks passed. Next: 01-launch.ts (dry-run first)." : "\nFix the FAIL / SHORT lines above before continuing.");
    if (!allPassed || anyShort) process.exitCode = 1;
}

runMain(main);
