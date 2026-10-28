# ForgeCapita Contracts — Service Status & Technical Health Report

**Service:** `forgecapita-contracts` (Solidity / Hardhat 3, OpenZeppelin clones)
**Networks:** Arbitrum Sepolia (`421614`) and BSC Testnet (`97`)
**Last Updated:** 2026-10-28
**Location of this file:** moved here from the workspace root on 2026-10-28.

**Current focus:** Step: WS-04.7 (hardening follow-up: Slither triage + 2 fixes) | State: awaiting-review (WS-04.8 still gated by CON-03.7 second reviewer and CON-03.10 decision) | Updated: 2026-10-28

## BLOCKED - WS-04.8 (until a second reviewer and one decision are handled)
Why: Slither is done and triaged (CON-03.6 and CON-03.6a ticked). Still open: an independent review and the on-chain cost settings.
You need to do:
1. CON-03.7: get a second reviewer for signature handling and roles; hand them the notes in backlog CON-03.7 (new `nonReentrant` stake paths; P2P accepts any token).
2. Decide CON-03.10: the safety margin (default 50%) and the registry values per chain (`maxCostPerAction`, surcharges; proposals in `docs/gas-measurements-v2.md` sections 5-7). The minimum funding goal itself is decided: computed LIVE (2026-10-28), see "Decision 2026-10-28" below.
3. Optional: re-run Slither after the two fixes: in the `forgecapita_hardhat` container, `slither . --filter-paths "mocks|node_modules"`.
How to confirm (no secrets in chat): tell me the review is done and state your choices.
Then run: /next-task WS-04.8

## Decision 2026-10-28: minimum funding goal is computed LIVE
The user decided the minimum funding goal is not a fixed number. The API computes it live from the smoothed gas price (plus the Arbitrum L1 fee estimate), the measured gas units, N, M and a margin; the frontend only displays it; it is not enforced on-chain.
Applied (docs only, no code): CON-03.10 reworded in `backlog-contracts.md`; `ROADMAP.md` notes; decision paragraph in `docs/v2-design.md` section 13 (tracker confirmed it is present at line 194). The goal tables in the gas doc and design doc are illustrative reference points only; CON-03.10 still needs the registry values (`maxCostPerAction`, surcharges).
PENDING (blocked by scope; `forgecapita-api` and `forgecapita-frontend` are outside the current step): backlog edits to API-41, API-71, FE-53 and FE-41. Exact drafted text is saved below. Apply them in a step or `/sync-status` run that includes those repos.

### Pending backlog edits (blocked by scope)

**API-41** (replace the item text in `forgecapita-api/backlog-api.md`):
> Minimum funding goal per chain, computed LIVE (decision 2026-10-28, not a fixed number): minGoal = gasUnitsPerProject x smoothedGasPrice x (1 + margin) / 0.05, plus on Arbitrum Sepolia the L1 fee estimate per sponsored transaction (txCount x l1FeePerTx x (1 + margin) / 0.05, txCount = N x (2 + M) + M = 705 for N=100, M=5). Gas units per project are fixed by the contract code and measured once (about 85.0M gas, forgecapita-contracts/docs/gas-measurements-v2.md); the gas price is live. Reuse the shared gas-price service from API-71 (5-minute samples in gas_samples, 24-hour average; no second sampler); extend it with the Arbitrum L1 fee estimate and expose getMinimumGoal(chainId) plus GET /api/v1/gas/:chainId/minimum-goal returning { minGoalWei, gasPriceUsed, l1FeeUsed, gasUnits, N, M, margin, windowHours, floor, ceiling, computedAt }. Admin-adjustable non-secret config (audit-logged): N, M, measured gas units, margin (default 50%), averaging window (default 24 h), optional per-chain floor and ceiling. Store the goal and chain on the application and reject applications below the minimum computed at submission (re-check at approval; small grace tolerance acceptable). The frontend shows the same value (FE-53) but this check cannot be bypassed from the browser. API/frontend rule only, not enforced on-chain. Depends on API-71.

**API-71** (append to the existing item text):
> This is the single shared gas-price service: the relay send policy (API-74), the frontend gas tracker (FE-41) and the live minimum funding goal (API-41) all read from it; also store the Arbitrum L1 fee estimate per transaction for API-41.

**FE-53** (replace the item text in `forgecapita-frontend/backlog-frontend.md`):
> Live minimum funding goal per chain (decision 2026-10-28, not a fixed number): the application and deploy forms show the current minimum for the selected chain (ETH on Arbitrum Sepolia, BNB on BSC Testnet), fetched from GET /api/v1/gas/:chainId/minimum-goal (API-41), with a short explanation that the 5% platform fee must cover the sponsored gas for about 100 investors and 5 milestones plus a safety margin. Show the numbers it is based on (gas units, smoothed gas price, L1 fee on Arbitrum, margin, averaging window, computed-at time) in an expandable "How is this calculated?" panel. Refresh periodically (for example every 60 s) and on chain change, warn if the entered goal falls below the minimum as the price moves; the form blocks submission below it, but the API (API-41) is the real enforcement. Reuse the gas tracker data and hooks from FE-41. Not enforced on-chain.

**FE-41** (append to the existing item text):
> Its data hook is reused by FE-53 (live minimum funding goal).

---

## 1. Executive Summary

**v1 is deployed to both testnets and frozen.** v2 (gasless relayer) is **planned, not started**. The v2 plan is in `backlog-contracts.md`. The freeze was lifted on 2026-10-28 (CON-00.1, CON-00.3 done, verified by hook probes): contracts may be edited, compiled and tested; deployment stays a user action. v1 addresses are recorded in `docs/deployments-v1.md` (CON-00.2, address half). The `v1-testnet` git tag exists. The v2 design draft `docs/v2-design.md` was written and **approved by the user on 2026-10-28** (changes: freeze limits of 45 days per freeze and 90 days cumulative; a per-chain minimum funding goal, section 13). It also lists two apparent v1 bugs (F1: `refundDeadProject` appears callable right after funding closes because `milestoneDeadline` starts at 0; F2: it becomes callable on a completed project) that are now confirmed by failing tests (see the update below and section 4a).

**Update 2026-10-28 (WS-04.3b, awaiting review):** `ForgeCapitaRegistry` (treasury, guardian, relayer allow-list, `maxCostPerAction`, `l1Surcharge`, two-step rotation) exists, and the factory, escrow, distributor, router and P2P exchange read roles from it at call time. F1 and F2 are fixed in v2 (v1 is unchanged and deployed). Compile clean; `npm test`: **187 passing, 0 failing**. Not deployed. The Ignition modules and `scripts/` are stale (still deploy the old factory). **Follow-up 2026-10-28 (user decisions):** the 120-day inactivity deadline (`milestoneDeadline`, `MAX_INACTIVITY_PERIOD`) is removed from `MilestoneEscrow`; `refundDeadProject` keeps its name but requires `projectCancelled`. A stalled developer is handled by guardian `emergencyShutdown` or `proposeNewDeveloper`. CON-02.21 (late start) is resolved as no longer applicable, and the freeze needs no clock pause. The guardian may `emergencyShutdown` a completed project (accepted). Then, by user decision, `cancelProject` was opened to the guardian too (CON-02.22). Now **195 passing, 0 failing**, MilestoneEscrow 11950 bytes. ABI change: getters `milestoneDeadline()` and `MAX_INACTIVITY_PERIOD()` are gone (sync in WS-05). Next: WS-04.4 (signed actions and permit).

**Update 2026-10-28 (WS-04.4, awaiting review):** signed actions and permit are in (CON-02.5 to CON-02.9). `MilestoneEscrow` gains EIP-712 (`ForgeCapita MilestoneEscrow`, "1"), `claimTokensFor(account)` (permissionless, pays the depositor) and `voteBySig(voter, support, deadline, signature)` (ERC-1271 capable, no nonce, single-use through `hasVoted`, bound to the current milestone). `ProjectToken` gains ERC-2612 `permit` (blocked after invalidation) and `DividendDistributor` gains `stakeWithPermit`. Compile clean; `npm test`: **227 passing, 0 failing**. MilestoneEscrow 13266 bytes. Not deployed; ABI sync is WS-05. Next: WS-04.5 (gas ledger and parameterless `executeMilestone`).

**Update 2026-10-28 (WS-04.5, awaiting review):** gas ledger and parameterless `executeMilestone()` are in (CON-02.10 to CON-02.14). The treasury-signature path is gone. Ledger `gasBudget`/`gasSpent`/`gasRecovered`, 15% cap (`MAX_DEBT_BPS`), `recordSponsoredGas(relayer, account, action, cost)` (distributor only), events `SponsoredGas`, `GasDebtRecovered`, `GasDebtWrittenOff`. Compile clean; `npm test`: **244 passing, 0 failing**. MilestoneEscrow 14777 bytes. Not deployed; ABI sync is WS-05 (indexer and frontend still hold the old `executeMilestone` ABI). Next: WS-04.6 (freeze).

**Update 2026-10-28 (WS-04.6, awaiting review):** bounded freeze is in (CON-02.15; CON-02.16 and CON-03.3 ticked). `freezeMilestones()` / `unfreezeMilestones()` are guardian-only; a freeze lapses after 45 days (cumulative cap 90 days); only `executeMilestone` is blocked. Compile clean; `npm test`: **267 passing, 0 failing** (244 + 23 in `test/Freeze.ts`). MilestoneEscrow 15983 bytes. Not deployed; ABI sync is WS-05. Next: WS-04.7 (tests, size, static analysis, gas report).

**Update 2026-10-28 (WS-04.7, awaiting review; tests and docs only at that point, `contracts/` unchanged then; later changed by CON-02.23 and the hardening follow-up):** coverage, regression, seeded invariant, size and gas-measurement tests added (CON-03.1, 03.2, 03.4, 03.5, 03.9 ticked; CON-03.6 partial). Tracker-verified `npm test`: **316 passing, 0 failing** (267 + 49 new; per-file `it(` counts by grep: 16 SignedActionsCoverage, 11 GasLedgerCoverage, 18 RegressionEdgeCases, 1 Invariants, 2 ContractSizes, 1 GasMeasurement = 49; the per-file counts in dev's report (15/13/22) were wrong, the total is right), 47 s mocha / about 63 s wall. Open: Slither (user action), second reviewer (CON-03.7), and two decisions: ledger under-booking (CON-02.23) and minimum-goal recalibration (CON-03.10). Next: WS-04.8 (deploy, user action) after those.

**Update 2026-10-28 (WS-04.7 hardening follow-up, awaiting review):** after the user's Slither run, two small contract fixes were made (user decision): `ForgeCapitaFactory.launchProject` now `require`s the token transfer ("Token transfer failed"); `DividendDistributor` `stake`, `stakeWithPermit`, `withdraw`, `claimYield` are `nonReentrant`. New test-only `contracts/mocks/MockReentrantStaker.sol` and `test/DividendDistributorReentrancy.ts` (6 tests). Tracker-verified: compile ok, `npm test` **322 passing, 0 failing**, ABI unchanged (no signature change). Slither triaged (section "Slither triage"); CON-03.6 and CON-03.6a ticked. Open before WS-04.8: CON-03.7 and CON-03.10.

**Earlier update 2026-10-28 (WS-04.3a, tests only):** a baseline regression suite for all v1 contracts now exists and `npm test` runs `hardhat test`. F1 and F2 are **confirmed** by two failing tests that assert the desired behaviour. No file under `contracts/` was changed. Next: WS-04.3b (registry, factory wiring, F1/F2 fixes).

The user accepted redeploying and re-syncing the indexer, so v2 is a fresh deployment (new factory, implementations, P2P exchange). v1 testnet projects are not migrated.

---

## 2. v1 Contracts (deployed, frozen)

`ForgeCapitaFactory` (EIP-1167 clones), `ProjectToken`, `MilestoneEscrow`, `DividendDistributor`, `RevenueRouter` per project, plus one `P2PExchange`.

- 5% platform fee at funding close; revenue split 24% developer / 1% treasury / 75% stakers; 1% P2P fee.
- Voting weight = staked balance in `DividendDistributor`; voters are locked until the poll closes. 28-day vote, 20% quorum, >50% fast track, 120-day inactivity deadlock (v1 only; removed in v2).
- 20% developer tokens vest at the final milestone.
- `emergencyShutdown` is callable only by the treasury: invalidates tokens, burns unvested tokens, sweeps ETH to the treasury.
- `proposeNewDeveloper` (developer or treasury) + `acceptDeveloperRole`.

## 3. v1 limitations that v2 addresses

| Limitation | Effect today | v2 item |
|---|---|---|
| No signed-message entry points; `msg.sender` only | Every claim, stake, vote and execute costs the user gas | CON-02.5 to CON-02.9 |
| `executeMilestone(gasDebt, signature)` always needs a treasury signature | Founder cannot be paid if the API is down or refuses to sign; the signature is also the only way to freeze payouts; signatures cannot be revoked | CON-02.10, CON-02.15 |
| Gas debt only exists off-chain | Nothing on-chain bounds or audits sponsored gas | CON-02.11 to CON-02.14 |
| One treasury key has fee, signing and shutdown power | A signing key on a server would also hold shutdown power | CON-02.1 to CON-02.3 |
| `stake` needs a separate token approval | Gasless staking would need a second transaction | CON-02.8 |
| `business-model.md` describes an on-chain Paymaster "Vault" that was never deployed | Documentation drift | CON-04.5 |

## 4. Not yet done

Phase 2: CON-02.1 to CON-02.4, CON-02.18 and CON-02.19 are done (WS-04.3b). CON-02.21 is resolved by removal of the inactivity deadline. CON-02.5 to CON-02.9 are done (WS-04.4). CON-02.10 to CON-02.14 are done (WS-04.5). CON-02.15 and CON-02.16 are done (WS-04.6). Remaining: CON-02.20 (user). CON-03.3 and CON-03.8 are done. Next: WS-04.7. CON-03.9 (gas report) is deferred to WS-04.7.

## 4a. Test baseline (updated WS-04.4, 2026-10-28)

After WS-04.4, tracker-verified: `npx hardhat compile` clean (nothing to recompile), `npm test` **227 passing, 0 failing** (195 + 22 in `test/SignedActions.ts` + 10 in `test/Permit.ts`; no existing test changed per dev, not independently diffed since the test files are untracked). Deployed bytecode sizes re-measured from artifacts (limit 24576): MilestoneEscrow 13266, ProjectToken 6515, DividendDistributor 3461, ForgeCapitaFactory 3283, ForgeCapitaRegistry 1625, P2PExchange 2563, RevenueRouter 2294. `git diff --stat`: 3 files, 96 insertions and 16 deletions; no line-ending churn (index and working copy are both LF for the edited files).

Earlier baseline (WS-04.3b):

After the guardian-cancel follow-up (2026-10-28), tracker-verified: `npm test` **195 passing, 0 failing**, MilestoneEscrow **11950 bytes**. (Previous: deadline removal, 189 passing, 11761 bytes.) The paragraph and size list below are the first WS-04.3b measurement (187 passing, MilestoneEscrow 12078); only MilestoneEscrow's size changed since.
After WS-04.3b, tracker-verified: `npx hardhat compile` clean, `npm test` **187 passing, 0 failing** (was 144 passing, 2 failing). New files: `test/ForgeCapitaRegistry.ts` (25 tests), `test/RegistryIntegration.ts` (12), `test/regressions-v1-fixes.ts` (replaces `known-issues-v1.ts`; F1 and F2 tests kept, now green). Two revert strings in existing tests changed to "Only active dev or Guardian can propose" and "Only Guardian can trigger emergency shutdown" (role rename; the test files are untracked so no git diff exists to compare, only skimmed). `test/RevenueRouter.ts` was extended.
Deployed bytecode sizes re-measured from artifacts (limit 24576): ForgeCapitaRegistry 1625, MilestoneEscrow 12078 (now 11761 after the follow-up), ForgeCapitaFactory 3283, RevenueRouter 2294, P2PExchange 2563, DividendDistributor 3170, ProjectToken 4212.

## 4b. Test baseline (WS-04.5, 2026-10-28)

Tracker-verified: `npx hardhat compile` clean, `npm test` **244 passing, 0 failing** (227 baseline, +24 in `test/GasLedger.ts`, -7 signature-only tests removed from `test/MilestoneEscrow.ts`). Sizes re-measured from artifacts (limit 24576): MilestoneEscrow 14777, ProjectToken 6515, DividendDistributor 3977, ForgeCapitaFactory 3283, ForgeCapitaRegistry 1625, P2PExchange 2563, RevenueRouter 2294. Test changes: `signGasDebt` helper removed, `approveCurrentMilestone` added, `approveAndExecuteMilestone` default executor is the deployer; one `RegistryIntegration` test rewritten; `regressions-v1-fixes` only has a helper call changed. Tracker read the full contract diff and the GasLedger test titles, not every test body.

## 4c. Test baseline (WS-04.6, 2026-10-28)

Tracker-verified: `npm test` **267 passing, 0 failing** (244 + 23 in `test/Freeze.ts`); `npx hardhat compile` reported nothing to recompile. Sizes re-measured from artifacts (limit 24576): MilestoneEscrow 15983, ProjectToken 6515, DividendDistributor 3977, ForgeCapitaFactory 3283, P2PExchange 2563, RevenueRouter 2294, ForgeCapitaRegistry 1625. Tracker read the freeze code (`MilestoneEscrow.sol` lines 392-429, `executeMilestone` guard) and the Freeze test titles plus the cumulative-cap tests; other test bodies not read.

## 4d. Test baseline (WS-04.7, 2026-10-28)

Tracker-verified: `npx hardhat compile` (nothing to recompile), `npm test` **316 passing, 0 failing**, mocha 47 s, wall about 63 s. `git status` in the contracts repo: only new untracked test files, `docs/gas-measurements-v2.md`, and `docs/v2-design.md` (+2 lines: the "Recalibration pointer" paragraph in section 13; the figures are untouched). `contracts/` unchanged at that point (CON-02.23 later changed it, see the change log); no existing test file modified. Sizes at that point (limit 24576, init code limit 49152; current MilestoneEscrow is 16040 after CON-02.23): MilestoneEscrow 15983, ProjectToken 6515, DividendDistributor 3977, ForgeCapitaFactory 3283, P2PExchange 2563, RevenueRouter 2294, ForgeCapitaRegistry 1625 (test-only `SponsoredGasCost` 57). Anti-vacuity checks by tracker: the size test reads artifacts and throws on non-hex bytecode, and its first test requires every production contract to be found; `Invariants.ts` contains 23 `expect` calls checked after state changes (stake sum equals total staked equals token balance, ledger bounds, etc.). Tracker skimmed Invariants.ts (first 120 lines plus greps), ContractSizes.ts in full and `docs/gas-measurements-v2.md` in full; other new test bodies not read. The measured gas figures were not re-run by the tracker (the doc is consistent with the dev's report and its own arithmetic: 100 x 842,466 + 751,927 = 84,998,527).

## 4e. Test baseline and Slither triage (WS-04.7 hardening follow-up, 2026-10-28)

Tracker-verified: `npx hardhat compile` (nothing to recompile), `npm test` **322 passing, 0 failing** (316 + 6 in `test/DividendDistributorReentrancy.ts`), `test/GasMeasurement.ts` run alone: 1 passing. `git diff -- contracts/`: `DividendDistributor.sol` (4 modifiers added) and `ForgeCapitaFactory.sol` (1 line) only; the new mock and test are untracked. Sizes from artifacts (limit 24576): MilestoneEscrow 16040, ProjectToken 6515, DividendDistributor 4200 (was 4009 after CON-02.23), ForgeCapitaFactory 3356, P2PExchange 2563, RevenueRouter 2294, ForgeCapitaRegistry 1625 (Registry not re-measured in this pass; unchanged source). Gas figures from dev (stake relayer steady 153,417 booked / 157,420 actual = 97.5%; first staker 88.7%) were not read from the tracker's own run output, only that the assertion test passes (>=95% steady, >=70% first call); `SponsoredGasCost` constants untouched. Dev note: in `stakeWithPermit` the guard cost is paid before `gasAtEntry` and is not booked (slight under-booking, within tolerance).

Anti-vacuity check of the new tests (tracker read both files): `MockReentrantStaker.receive()` really re-enters the distributor with `claimYield`, `withdraw(1)` or `stake(1)` through a low-level call and stores `ok` and the revert data; the test asserts `reentered == true`, `reentrySucceeded == false` and that the revert data equals the selector of `ReentrancyGuardReentrantCall` (3 parametrised tests); a fourth checks the yield is paid exactly once (`YieldClaimed` args, balance delta, rewards 0); a fifth that withdraw/claim still work afterwards; a sixth that `routePayment` still reaches `receive()` (unguarded). Caveat: the re-entry is exercised from `claimYield`'s ETH transfer only; the guard on `stake`, `stakeWithPermit` and `withdraw` as outer calls is not re-entered from a hook (their only external calls are to the project's own token, which has no hooks). Dev's claims about modifier order and the clones were confirmed by reading the diff (order `nonReentrant updateDividend`).

### Slither triage (user ran `slither . --filter-paths "mocks|node_modules"` in container `forgecapita_hardhat`; 47 contracts, 102 detectors, 62 results, none high; mocks excluded; run on the code BEFORE the two fixes; NOT re-run afterwards)
Triage is the tracker's assessment from the caller's summary; the raw Slither output was not seen by the tracker and the P2P code was not read in full.

| Detector / location | Assessment | Outcome |
|---|---|---|
| arbitrary-send-eth `RevenueRouter.claimTreasuryFunds` | Destination is the registry treasury, not the caller | False positive |
| unchecked-transfer `ForgeCapitaFactory.launchProject` (line 94) | Return value ignored | FIXED: `require(..., "Token transfer failed")` |
| reentrancy-no-eth `DividendDistributor.stakeWithPermit` | Low risk (only external calls go to the project's own token, state written before `transferFrom`) | FIXED additionally: `nonReentrant` on all four stake paths |
| missing-zero-check: factory constructor masters, `MilestoneEscrow.initialize` developer, `RevenueRouter.initialize` escrow/distributor, `DividendDistributor.initialize` factory | Factory always passes real values; only a deployment-script mistake could trigger | ACCEPTED; optional hardening CON-03.15 |
| reentrancy-benign `MilestoneEscrow.claimTokensFor` (gasSpent updated after transfer of the project's own token) | Low | ACCEPTED |
| reentrancy-benign `ForgeCapitaFactory.launchProject` (trusted clones) | Low | ACCEPTED |
| reentrancy-benign `P2PExchange.createListing` (`transferFrom` on a seller-chosen token before the listing is written) | A malicious token only affects listings of that token; P2P accepts any token, so buyers must check the token; frontend should warn | ACCEPTED low; see CON-03.7 note and CON-03.16 |
| reentrancy-events, timestamp, low-level-calls, missing-inheritance (ProjectToken vs IProjectToken), naming-convention | Deadlines are in days; all low-level success flags checked; style | INFORMATIONAL, accepted |

Optional re-run for the user (not required): in the `forgecapita_hardhat` container, `slither . --filter-paths "mocks|node_modules"`; expect the Factory unchecked-transfer and the `stakeWithPermit` reentrancy result to be gone.

### Open findings after WS-04.7
- RESOLVED 2026-10-28 (CON-02.23): cost is now booked at the end of each relayer call plus fixed overheads. Booked vs actual steady: claim 96.2%, stake 99.0%, vote 97.7%, execute 96.8% non-final / 97.0% final; first-in-project calls lower on purpose (claim 74.2%). `npm test` 316 passing; sizes: MilestoneEscrow 16040, DividendDistributor 4009, Factory 3283, Registry 1625, P2P 2563, ProjectToken 6515, RevenueRouter 2294. Follow-ups CON-03.12 (re-derive surcharges/caps, re-check CON-03.10) and CON-03.13 (recalibrate on gas shifts). Historic text (superseded by the 2026-10-28 re-measurement): the ledger under-books relayer cost (gasleft() read early): claim 81%, stake 97%, vote 81%, execute 41% non-final / 30% final of actual gas. With zero surcharges, real platform spend about 85.0M gas vs about 70.9M booked (83%). The ceiling still bounds recoverable amounts; real exposure above it is larger. Options: raise per-action `l1Surcharge` (doc section 5), or contract change to book at end of call.
- DECISION CON-03.10 (open, user chooses): re-measured 2026-10-28 (WS-04.7b, CON-03.12 done): 85,020,820 gas per project (about 15% above the 73.75M in design section 13); proposals in `docs/gas-measurements-v2.md` sections 5-7: BSC 1 gwei goal 2.55 BNB, maxCostPerAction 3.5e14, surcharges 4.5e12/1.5e12/2.5e12/3.5e12 (or all 0); BSC 3 gwei goal 7.65 BNB, 1e15, 1.35e13/4.5e12/7.5e12/1.05e13; Arbitrum Sepolia goal 1.52 ETH, 2e14, 6.04e13/6.01e13/6.02e13/6.03e13 (prices and the 0.00006 ETH L1 fee are estimates). Whole-project booked/actual 97.55% (99.75% BSC, 99.89% Arbitrum with the proposed surcharges); at the minimum goal the ledger never binds in the design scenario. FE-53 and API-41 depend on the chosen values. On Arbitrum the L1 fee is about 83% of cost, so `l1Surcharge` must be set.
- NEW (CON-03.14, optional): `executeMilestone` with a deduction is under-booked (booked about 108k/148k vs actual 145.7k/169.6k, 74%/87%); occurs only when the project is already over budget (about 0.2% of project gas) and is not covered by the flat surcharge. Fixing it would be a contract change; not done.
- Registry caps `maxCostPerAction` and `l1Surcharge` at 1 ETH each.
- Dev self-review: no issue; low-risk note that `stakeWithPermit` and `claimYield` lacked `nonReentrant` (CEI holds). RESOLVED in code 2026-10-28 (guard added on all four stake paths); the second reviewer still confirms (CON-03.7 / CON-03.11).
- ERC-1271 reentrancy is only exercised through the existing mock that re-enters `vote()`.
- Invariant tests are seeded randomised scenarios (10, seed 20261028), not a fuzzer.
- Slither run and triaged 2026-10-28 (CON-03.6a done; see "Slither triage"). CON-03.7 (second reviewer) not done.

### Open findings after WS-04.6
- No security issue found. Checked: guardian-only via `registry.guardian()` (follows rotation); a freeze cannot be extended (`Already frozen`); total never exceeds 90 days (settle lapsed freeze, require settled < 90, duration clamped); state is written before the event; `isFrozen()` is referenced only by `executeMilestone` and the freeze functions, so cancel, refund, shutdown, vote, stake and claims are unaffected.
- `totalFrozen` is the settled total only: a lapsed freeze is added when the next `freezeMilestones()` runs, so the getter can under-report by up to 45 days. The event value `totalFrozen` in `MilestonesFrozen` is the projected total including this freeze. A frontend/indexer must compute `effective = totalFrozen + (freezeStart != 0 ? frozenUntil - freezeStart : 0)` (or add a view later; optional, not done).
- Event signatures differ from design section 7 (no `by`, no `extension`): see backlog CON-02.15. Needs a `docs/v2-design.md` edit.
- The guardian can freeze/unfreeze repeatedly at no cost when frozen time is zero (unfreeze in the same block); harmless, only event spam.
- A freeze blocks the final-milestone vesting and payouts for its duration, by design; the votes continue and may pass during a freeze.
- CON-02.16 is judged from test names and counts, not an assertion audit.
- ABI changes for WS-05 and IDX-10: new functions `freezeMilestones`, `unfreezeMilestones`, `isFrozen`; getters `freezeStart`, `frozenUntil`, `totalFrozen`, `MAX_FREEZE_DURATION`, `MAX_TOTAL_FREEZE`; events `MilestonesFrozen(uint256 until, uint256 totalFrozen)`, `MilestonesUnfrozen(uint256 totalFrozen)`.

### Open findings after WS-04.5
- Gas measurement is an approximation: the nonReentrant guard and the payout transfers after the record point are not counted, so recorded cost is slightly below real cost. The per-action cap and the 15% ceiling still bound exposure.
- The final-milestone write-off is nearly unreachable: the ceiling (budget + 15% of netFunds) means overflow is at most the sum of the per-milestone 15% caps, so only rounding dust can remain. Kept as a safety net.
- Registry defaults `maxCostPerAction` and `l1Surcharge` are 0. Until the guardian sets them (and adds the relayer) every relayer call records cost 0. This must be done after deployment (add to WS-04.8 / CON-04 checklist).
- Before funding closes the ceiling is 0, so any relayer-submitted call with non-zero cost reverts with "Gas ceiling exceeded"; relayer must not be used pre-close (API should self-pay hint).
- The distributor computes the cost and the escrow trusts it (only the project's distributor may call `recordSponsoredGas`); `action` is not range-checked. Acceptable because the distributor is deployed by the factory.
- A reverting treasury address blocks `executeMilestone` when a deduction is above 0 (and `closeFundingAndStart`); the treasury is registry-controlled and rotatable. Already noted as a general risk.
- 7 tests were removed (treasury-signature path no longer exists); their intent is covered by `GasLedger.ts` (permissionless execution, old selector gone). No security issue found in the diff.
- ABI changes for WS-05 and IDX-10: `executeMilestone()` has no parameters; new `SponsoredGas`, `GasDebtRecovered`, `GasDebtWrittenOff`, new getters `gasBudget`, `gasSpent`, `gasRecovered`, `MAX_DEBT_BPS`, new `recordSponsoredGas`.

### Open findings after WS-04.4
- ERC-1271 reentrancy test caveat: `does not let a malicious wallet re-enter during validation` is only partly meaningful, because OZ `SignatureChecker` calls the wallet with `staticcall`, which cannot change state. `nonReentrant` on `voteBySig` is defence in depth and is not independently proven by that test.
- `contracts/mocks/MockERC1271Wallet.sol` is a test-only mock inside `contracts/`; it compiles into artifacts but is never deployed. Exclude it from deployment modules, size reviews and Slither scope (WS-04.7).
- Resolved in WS-04.5: `stakeWithPermit` now reports sponsored gas to the escrow.
- Permit domain name equals the token name chosen at launch; a front-end must read `name()` and `nonces()` from the token.

### Open findings after WS-04.3b
- Resolved 2026-10-28: late start (CON-02.21) is moot because the inactivity deadline was removed; the guardian-shutdown-of-completed-project note below is accepted by the user.
- Accepted consequences of removing the deadline (open, not defects): there is no permissionless investor exit unless the developer calls `cancelProject`; a vote lock persists until the guardian acts on a stalled project; the guardian cancel was added (CON-02.22, 2026-10-28), so a stalled project can be cancelled by the guardian. Trust note: the guardian can cancel any funded non-completed project; unvested developer tokens stay in escrow after cancel; stakers must unstake before refunding.
- Stale deployment files (CON-04.0): the Ignition modules and `scripts/` were not updated and no longer match the factory constructor and initializers.
- Review notes (no blocking issue found): a reverting treasury address blocks `closeFundingAndStart`, sweeps and fee payments until rotated; `initialize` functions do not reject a zero registry (the factory always passes a real one); the gas-debt signature is still ECDSA from the treasury EOA only (replaced in WS-04.5).

### WS-04.3a baseline (historical, 2026-10-28)

Verified by running `npm test` (`hardhat test`): **144 passing, 2 failing** (146 tests). The only failures are the two tests in `test/known-issues-v1.ts`.

- Files: `test/ForgeCapitaFactory.ts`, `test/MilestoneEscrow.ts`, `test/DividendDistributor.ts`, `test/ProjectToken.ts`, `test/RevenueRouter.ts`, `test/P2PExchange.ts`, `test/known-issues-v1.ts`, shared helpers in `test/helpers/protocol.ts`. Fixtures launch a project with milestones [40,60], goal 10 ETH, funders Alice 4 / Bob 3 / Carol 3 ETH.
- `test/RevenueRouter.ts` was stale (constructor and 80/20 split that the deployed clone-based contract does not have) and was rewritten.
- Hardhat 3 chai matchers need `.to.be.revert(ethers)`. Revert strings are asserted verbatim, so WS-04.3b must update tests when messages or signatures change.
- **F1 confirmed (fixed in v2, WS-04.3b; v1 unchanged):** `refundDeadProject` does not revert right after funding closes (milestone 0 not started, not cancelled): "Expected transaction to be reverted with reason 'Project is still healthy', but it didn't revert" (`known-issues-v1.ts:25`). Cause per dev: `milestoneDeadline` is 0.
- **F2 confirmed (fixed in v2, WS-04.3b; v1 unchanged):** after the final milestone executed and 121 days passed, `refundDeadProject` succeeds on the completed project: "Expected transaction to be reverted" (`known-issues-v1.ts:39`).
- Contract sizes (bytes, limit 24576), as reported by dev from compile, not re-measured by the tracker: MilestoneEscrow 11440, ProjectToken 4212, ForgeCapitaFactory 3155, DividendDistributor 3088, P2PExchange 2390, RevenueRouter 2151.
- `npx tsc --noEmit` has two pre-existing errors outside `test/` (`hardhat.config.ts` customChains type; `scripts/scenario13.ts` ethers namespace). Per dev, not touched; the tracker did not re-run tsc.

### Suspected v1 issues, UNVERIFIED (no test written; do not treat as findings)
- (a) `refundDeadProject` divides by `remainingPublicTokens` but pays from the whole escrow balance, including ETH that arrived outside funding.
- (b) The Treasury gas-debt signature has no nonce or expiry. By design in v1; the v2 ledger replaces it.
- The "same tokens vote twice via a second wallet" idea was rejected: voting locks staked tokens until the poll closes.

## 5. Summary Checklist of Next Steps

1. [x] CON-00.1 freeze lifted; CON-00.3 tracking scope updated.
   [x] CON-00.2 `v1-testnet` tag created; v1 addresses recorded.
2. [x] CON-01 design document written and approved (decisions CON-01.2 to CON-01.7 resolved).
3. [x] CON-03.8 baseline regression suite and failing F1/F2 tests (WS-04.3a, awaiting user review).
4. [x] WS-04.3b registry, factory wiring, F1/F2 fixes (CON-02.1 to CON-02.4, CON-02.18, CON-02.19); F1/F2 tests green, baseline green (awaiting user review).
   [x] CON-02.21 resolved by removing the 120-day inactivity deadline (user decision 2026-10-28).
   [ ] CON-04.0 update Ignition modules and `scripts/` for the registry and new initializers (WS-04.8, user-run).
5. [x] CON-02.10 to CON-02.14 gas ledger and parameterless `executeMilestone` (WS-04.5, awaiting review).
   [x] CON-02.15, CON-02.16, CON-03.3 freeze and regression (WS-04.6, awaiting review).
   [x] CON-03.1, 03.2, 03.4, 03.5, 03.9 (WS-04.7, awaiting review); CON-03.6 size gate and gas report done.
   [x] CON-03.12 re-derive suggested values and minimum goals (WS-04.7b, awaiting review); CON-03.14 optional new item.
   [x] CON-03.6, CON-03.6a Slither run and triaged; 2 hardening fixes (WS-04.7 follow-up, awaiting review).
   [ ] CON-03.7 second reviewer; CON-03.10 decision (margin + on-chain cost settings). Optional: CON-03.15 zero-address checks, CON-03.16 P2P any-token. CON-02.23 resolved 2026-10-28; CON-03.12 done; CON-03.13 open.
6. [ ] `[USER-ACTION]` CON-04 deploy to both testnets, fund and allow-list the relayer.

---

## Change log

2026-10-28  WS-04.7 (hardening follow-up)  Slither (run by the user) triaged: no high findings, 62 results. Fixes: `require` on the token transfer in `ForgeCapitaFactory.launchProject`; `nonReentrant` (order `nonReentrant updateDividend`) on `DividendDistributor.stake/stakeWithPermit/withdraw/claimYield`; test-only `MockReentrantStaker` and `test/DividendDistributorReentrancy.ts` (6 tests). Sizes: DividendDistributor 4200, Factory 3356. CON-03.6 and CON-03.6a ticked; CON-03.15 and CON-03.16 (optional) added; CON-03.7 note for the reviewer (stake paths, P2P any token); CON-03.11 updated. Slither NOT re-run after the fixes  - verified by: tracker ran compile and `npm test` (322 passing, 0 failing), `test/GasMeasurement.ts` alone (1 passing), re-measured artifact sizes, read `git diff -- contracts/` and both new test files in full; Slither output itself not seen by the tracker; dev's gas percentages not independently read

2026-10-28  Decision (CON-03.10)  User decided the minimum funding goal is computed LIVE (API-41, shown by FE-53), not a fixed number. Applied: CON-03.10 reworded in `backlog-contracts.md`, `ROADMAP.md` notes, decision paragraph in `docs/v2-design.md` section 13. PENDING (out of step scope): API-41, API-71, FE-53, FE-41 backlog edits; drafts saved in this file under "Pending backlog edits (blocked by scope)". CON-03.10 still open for registry values  - verified by: tracker grep found the decision paragraph at `docs/v2-design.md` line 194; the `backlog-contracts.md` and `ROADMAP.md` edits were reported by the caller and not re-read; no code changed, tests not re-run

2026-10-28  WS-04.7b (CON-03.12)  Docs only: `docs/gas-measurements-v2.md` re-measured after CON-02.23 (85,020,820 gas, relayer units claim 124,427 / stake 154,951 / vote 112,661 / execute 111,707 non-final, 152,726 final, 145,720 / 169,640 with deduction), new sections 5-7 (suggested values, whole-project booked vs budget/ceiling/15% cap, decision table); pointer paragraph in `docs/v2-design.md` section 13 updated, figures unchanged; CON-03.12 ticked, CON-03.10 text refreshed (still an open decision), CON-03.14 added (execute with deduction under-booked)  - verified by: tracker re-ran `npm test` (316 passing, 0 failing), `git status` shows only `docs/gas-measurements-v2.md` and `docs/v2-design.md` modified, no `contracts/` or test change; arithmetic spot-checked (100 x 842,683 + 752,520 = 85,020,820; gap 2,082,707 / 85,020,820 = 2.45%; goal = 0.08502 BNB x 1.5 / 0.05); per-unit gas figures not independently isolated

2026-10-28  WS-04.7 (CON-02.23)  Contracts: `SponsoredGasCost.cost()` takes an overhead argument with named constants; claim/vote/stake book at end of call; `executeMilestone` books after computing `isFinalMilestone`, before state changes, with fixed payout-tail constants; `stakeWithPermit` passes STAKE_OVERHEAD; ABI unchanged; CON-02.23 resolved, CON-03.12/03.13 added  - verified by: tracker ran compile and `npm test` (316 passing, 0 failing), read the source diff, bytecode sizes from artifacts match (MilestoneEscrow 16040)
2026-10-28  WS-04.7  Tests and docs only: `test/helpers/extra.ts`, `SignedActionsCoverage.ts`, `GasLedgerCoverage.ts`, `RegressionEdgeCases.ts`, `Invariants.ts`, `ContractSizes.ts`, `GasMeasurement.ts` (49 new tests), `docs/gas-measurements-v2.md`, pointer paragraph in `docs/v2-design.md` section 13; CON-03.1, 03.2, 03.4, 03.5, 03.9 ticked, CON-03.6 partial (size gate done); new items CON-03.6a (user: Slither), CON-02.23 (decision: ledger under-booking), CON-03.10 (decision: minimum goals), CON-03.11 (reviewer note)  - verified by: tracker re-ran `npx hardhat compile` and `npm test` (316 passing, 0 failing, 47 s), re-ran the size test, `git status` shows `contracts/` unchanged and no tracked test modified, read ContractSizes.ts, the head of Invariants.ts and the gas doc; gas numbers not re-run

2026-10-28  WS-04.6  `MilestoneEscrow` freeze: `MAX_FREEZE_DURATION` 45 days, `MAX_TOTAL_FREEZE` 90 days, `freezeStart`/`frozenUntil`/`totalFrozen`, `isFrozen()`, guardian-only `freezeMilestones()`/`unfreezeMilestones()`, events `MilestonesFrozen(until, totalFrozen)` / `MilestonesUnfrozen(totalFrozen)`, `executeMilestone` reverts "Milestones frozen"; `test/Freeze.ts` (23 tests); CON-02.15, CON-02.16, CON-03.3 ticked  - verified by: tracker re-ran `npm test` (267 passing, 0 failing; compile had nothing to recompile), re-measured artifact sizes (MilestoneEscrow 15983), read the freeze code and the cap/clamp tests; other test bodies and the full diff not read

2026-10-28  WS-04.5  `executeMilestone()` parameterless and permissionless, treasury signature removed; gas ledger (`gasBudget`, `gasSpent`, `gasRecovered`, 15% cap), `recordSponsoredGas`, `SponsoredGas`/`GasDebtRecovered`/`GasDebtWrittenOff`; `SponsoredGasCost` library; claim, vote, stake and execute record relayer cost; 24 new tests, 7 removed; CON-02.10 to CON-02.14 ticked with wording notes  - verified by: tracker re-ran `npx hardhat compile` and `npm test` (244 passing, 0 failing), re-measured artifact sizes (MilestoneEscrow 14777), read `MilestoneEscrow.sol` in full plus the distributor, interface and library diffs and the GasLedger test titles (not every body); no `executeMilestone` callers left in `contracts/` besides the escrow

2026-10-28  WS-04.4  `MilestoneEscrow` EIP-712 + `claimTokensFor` + `voteBySig`; `ProjectToken` ERC-2612 permit with `checkValidity`; `DividendDistributor.stakeWithPermit`; `contracts/mocks/MockERC1271Wallet.sol` (test-only); 32 new tests; CON-02.5 to CON-02.9 ticked with wording notes (no ClaimTokens/Stake/ExecuteMilestone structs, no nonce for votes)  - verified by: tracker ran `npx hardhat compile` and `npm test` (227 passing, 0 failing), re-measured artifact sizes (MilestoneEscrow 13266), read the full `git diff -- contracts` and the test titles (not the test bodies); `git ls-files --eol` shows LF in index and working copy, so no line-ending churn; reentrancy test is weak by construction (staticcall)

2026-10-28  WS-04.3b (guardian cancel)  `MilestoneEscrow.cancelProject` now callable by developer or `registry.guardian()` (revert "Only developer or Guardian can cancel"); new guards "Project already cancelled" and "Project is completed"; `ProjectCancelled(string)` unchanged (no ABI signature change); tests added; CON-02.22 added and ticked; CON-04.7(a) done, (b) stale docs still open. Trust note: the guardian can now cancel any funded, non-completed project; unvested developer tokens stay in escrow after cancel; stakers must unstake before refunding  - verified by: tracker re-ran `npm test` (195 passing, 0 failing), measured MilestoneEscrow 11950 bytes from the artifact, read `MilestoneEscrow.sol` lines ~355-370 (not the full diff or the new test bodies)

2026-10-28  WS-04.3b (docs)  `docs/v2-design.md` is now updated for the deadline removal (sections 3, 6, 9, 10, 12); section 4a now states the 189 passing / 11761 bytes numbers; pending decision recorded (admin cancel function, undecided) and a follow-up item added in the backlog (CON-04.7) listing docs that still mention the 120-day refund  - verified by: caller report only; tracker did not re-read `docs/v2-design.md` and did not re-run tests in this pass (189 / 11761 figures from the earlier tracker run)

2026-10-28  WS-04.3b (follow-up)  Removed the 120-day inactivity deadline from `MilestoneEscrow` (`milestoneDeadline`, `MAX_INACTIVITY_PERIOD`); `refundDeadProject` now requires `projectCancelled`; tests updated; CON-02.21 resolved as not applicable; freeze needs no clock pause; guardian shutdown of completed project accepted; 189 tests passing; MilestoneEscrow 11761 bytes; ABI getters removed  - verified by: tracker ran `npm test` (189 passing, 0 failing; compile reported nothing to recompile), measured MilestoneEscrow deployed bytecode 11761 bytes from the artifact, grep of `contracts/` and `test/` finds no `milestoneDeadline`/`MAX_INACTIVITY` (only two test titles mentioning "120 days of inactivity"); did not read the full diff. Note: `docs/v2-design.md` could not be updated by the tracker (scope hook), pending edit by caller

2026-10-28  WS-04.3b  Added `ForgeCapitaRegistry`; factory, escrow, distributor, router and P2P read roles from it; F1/F2 fixed in v2; 187 tests passing; CON-02.1 to CON-02.4, CON-02.18, CON-02.19 ticked; added CON-02.21 and CON-04.0  - verified by: tracker ran `npx hardhat compile` and `npm test` (187 passing, 0 failing), re-measured artifact sizes, read the registry and `git diff -- contracts`; Ignition and `scripts/` absent from `git status`

2026-10-28  WS-04.3a  Added baseline regression suite (146 tests) and failing F1/F2 tests; `npm test` wired to `hardhat test`; stale RevenueRouter test rewritten; CON-03.8 ticked; CON-03.9 deferred to WS-04.7  - verified by: `npm test` run by tracker (144 passing, 2 failing = F1, F2), `git status` shows no change under `contracts/`, test files opened (known-issues-v1.ts)
