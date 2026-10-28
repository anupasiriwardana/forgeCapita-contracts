# ForgeCapita Contracts — Development Backlog (v2: gasless relayer)

This backlog tracks **contracts v2** for `forgecapita-contracts` (Solidity / Hardhat 3). v1 is deployed to Arbitrum Sepolia `421614` and BSC Testnet `97`. The folder was unfrozen for v2 work on 2026-10-28 (CON-00.1); deployment stays a user action. This file was moved here from the workspace root on 2026-10-28.

> **Legend:**
> - `[x]` Completed
> - `[ ]` Pending
> - `[USER-ACTION]` Requires manual action or credential provisioning from the repository owner/user.
> - `[DECISION]` Open design question; resolve in CON-01 before implementing.
> - `[DEFERRED]` Planned, not scheduled.

## Why v2

Users should not pay gas for four actions: **claim tokens, stake, vote, execute a milestone**. Everything else (invest, claim yield, refund, create project, send revenue, unstake, P2P, token approvals) stays user-paid. A ForgeCapita **relayer** wallet submits the gasless transactions; the user only signs a message in MetaMask (no smart wallet needed). v1 cannot do this: it has no signed-message entry points, its only gas feature is a treasury signature on `executeMilestone`, and one treasury key holds every privileged power.

## Decisions already made (do not re-litigate)

- Gasless for: `claimTokens`, `stake`, `vote`, `executeMilestone`. User-paid: everything else.
- The treasury keeps 100% of the 5% platform fee and pays the relayer's gas from it. The contract keeps a **per-project gas ledger** only for accounting.
- Per project: `gasBudget` = the 5% fee collected at funding close. When sponsored gas spent exceeds the budget, the **overflow is recovered from milestone payouts**, capped at **15% of each milestone release** (`MAX_DEBT_BPS = 1500`). Unrecovered overflow carries to the next milestone.
- Wallets: **treasury/admin** is one wallet (fees, shutdown, freeze). The **relayer** is a separate server-held hot wallet allowed to submit gasless actions only.
- Queue policy (off-chain, API): a signed request waits at most 6 hours, or less when a vote is about to close. The signature carries a `deadline`.
- Freeze: bounded. Each freeze lapses after 45 days, the admin may unfreeze earlier, and cumulative freeze time per project is capped at 90 days; the inactivity clock is paused only for the frozen time elapsed.
- Registry (`ForgeCapitaRegistry`) holds treasury, guardian, relayer allow-list and sponsorship parameters for every project. Only vote (EIP-712) and stake (ERC-2612 permit) need a user signature; claim and execute need none. Details: `docs/v2-design.md` (approved 2026-10-28).
- Minimum funding goal per chain (enforced in the frontend and API, not on-chain) so that 5% covers 100 investors and 5 milestones plus margin: design section 13.
- Fix v1 issues F1 and F2 (refund timing) in v2.
- Preserve v1 behaviour: 5% funding fee, 24/1/75 revenue split, 1% P2P fee, staked-weight voting with vote lock, 20% dev vesting at the final milestone, 28-day vote, 20% quorum, >50% fast track, 120-day inactivity deadlock, `emergencyShutdown` semantics, two-step developer change.

---

## Phase 0: Preconditions

- [x] **CON-00.1 `[USER-ACTION]`** (done 2026-10-28, verified by hook probes: contracts edit/compile/test allowed, deploy/ignition/run/verify blocked) Lift the freeze so Claude may edit and compile the contracts. Claude cannot do this (`.claude/` is user-managed). Steps:
  1. In `CLAUDE.md`, change the hard rule and table row for `forgecapita-contracts` to editable for v2 (compile and test only; deployment stays manual).
  2. In `.claude/settings.json`, remove `Edit(/forgecapita-contracts/**)` from deny and allow `npx hardhat compile` / `npx hardhat test` (keep deploy and ignition commands denied).
  3. In `.claude/hooks/guard.js`, remove the `forgecapita-contracts/` edit block and narrow the Hardhat block to deploy/ignition/run/verify.
  4. In `.claude/agents/dev.md`, add contracts to the repos the dev agent may edit.
  5. Confirm to Claude in chat.
- [x] **CON-00.2 `[USER-ACTION]`** (tag `v1-testnet` created 2026-10-28) In the contracts repo, tag the exact v1 deployed commit (`git tag v1-testnet`) (the v1 addresses are already recorded in `docs/deployments-v1.md`; only the tag is left). Git writes are blocked for Claude.
- [x] **CON-00.3** (done 2026-10-28: `REPOS` in `lib.js` now includes contracts) Add `ROADMAP.md` "Current step" scope support for the contracts repo (tracker/guard configuration) — user-managed hooks; confirm after CON-00.1.

## Phase 1: Design

- [x] **CON-01.1** (draft written 2026-10-28; decisions CON-01.2 to CON-01.7 are proposed in section 9 and questions in section 12 await the user's approval) Write `docs/v2-design.md`: roles, EIP-712 request types, nonce scheme, gas ledger math, freeze semantics, upgrade/rotation rules, event list, threat model (replay, cross-chain replay, relayer abuse, griefing via inflated debt, front-running, signature malleability).
- [x] **CON-01.2 `[DECISION]`** (resolved 2026-10-28: per-function entry points; only vote and permit need a signature) Signed-action approach: per-function `...BySig` entry points (recommended: narrow surface) vs a general ERC-2771 trusted forwarder.
- [x] **CON-01.3 `[DECISION]`** (resolved: `gasleft()` + calldata bound + flat `l1Surcharge`, capped per action) Gas measurement: contract measures `gasleft()` delta plus a fixed overhead constant × `tx.gasprice`. On Arbitrum the L1 data fee is not visible in `tx.gasprice`; choose between a flat per-action surcharge, the ArbGasInfo precompile, or a relayer-reported cost bounded by a hard cap.
- [x] **CON-01.4 `[DECISION]`** (resolved: write off; minimum funding goal per chain, design section 13) Overflow still unrecovered after the final milestone: write it off (recommended) or hold back from the 20% developer vesting.
- [x] **CON-01.5 `[DECISION]`** (resolved: pauses the clock; 45 days per freeze with automatic lapse, 90 days cumulative per project) Freeze semantics: does a freeze pause the 120-day inactivity clock (recommended, so a freeze cannot push a founder into a deadlock they did not cause)?
- [x] **CON-01.6 `[DECISION]`** (resolved: anyone, once executable and not frozen) Who may trigger `executeMilestone` once executable: anyone (recommended, payout always goes to the developer) vs developer/relayer only.
- [x] **CON-01.7 `[DECISION]`** (resolved: registry cap per action, project exposure ceiling, per-wallet limits in the API) Per-action sponsored-cost cap and per-project sponsored-action rate limit.

## Phase 2: Implementation

> **Design revision 2026-10-28 (see `docs/v2-design.md`):** roles and the relayer allow-list live in a shared `ForgeCapitaRegistry` instead of per project (CON-02.1 to CON-02.4 are implemented through it, CON-02.18). Only **vote** (`voteBySig`) and **stake** (`stakeWithPermit`, ERC-2612) need a user signature; **claim** is `claimTokensFor(account)` and **execute** is a parameterless permissionless `executeMilestone()`, so CON-02.5 to CON-02.7 and CON-02.10 shrink accordingly. Pending the user's approval of design section 12.

### Roles & configuration
- [ ] **CON-02.1** `guardian` role (shutdown, freeze/unfreeze). Defaults to the treasury; separate variable so it can later move to a multisig. `emergencyShutdown` becomes guardian-only (treasury == guardian at launch).
- [ ] **CON-02.2** `relayer` allow-list managed by the treasury. Only allow-listed relayers may submit signed actions.
- [ ] **CON-02.3** Two-step rotation (propose/accept) for treasury, guardian and relayer. `[DEFERRED]` timelock for role changes.
- [ ] **CON-02.4** Factory passes treasury, guardian and relayer registry into every clone at `launchProject`.

### Signed (gasless) actions
- [ ] **CON-02.5** EIP-712 domain (name, version, `chainId`, `verifyingContract`) and typed structs for `ClaimTokens`, `Stake`, `Vote`, `ExecuteMilestone`, each with `signer`, `nonce`, `deadline`.
- [ ] **CON-02.6** Per-signer nonces; reject expired deadlines, reused nonces, wrong chain, wrong contract. Use OpenZeppelin `SignatureChecker` (ECDSA + ERC-1271 so smart wallets can sign) with malleability protection.
- [ ] **CON-02.7** `claimTokensBySig` — tokens go to the signer, never to the relayer.
- [ ] **CON-02.8** `ProjectToken` gains ERC-2612 `permit` (respecting `checkValidity` / emergency invalidation) and the distributor gets `stakeBySig` that consumes a permit in the same call, so staking is one signature and needs no separate approval.
- [ ] **CON-02.9** `voteBySig` — same weight and vote-lock rules as `vote`; the lock applies to the signer; the developer remains barred from voting.
- [ ] **CON-02.10** `executeMilestone` no longer takes `gasDebt` or a treasury signature (see Gas ledger). Signature-based freeze bypass removed.

### Gas ledger
- [ ] **CON-02.11** Per-project ledger in `MilestoneEscrow`: `gasBudget` (set to the platform fee at `closeFundingAndStart`), `gasSpent`, `gasRecovered`. Distributor and token report sponsored costs to the escrow through a restricted call.
- [ ] **CON-02.12** Every relayer-submitted action records its cost (CON-01.3) up to the per-action cap (CON-01.7) and emits `SponsoredGas(project, actionType, signer, cost, gasSpent)`.
- [ ] **CON-02.13** At execution: `overflow = max(0, gasSpent - gasBudget) - gasRecovered`; `deduction = min(overflow, 15% of the milestone release)`; pay `deduction` to the treasury, the rest to the developer; emit `GasDebtRecovered`. Apply the CON-01.4 rule at the final milestone.
- [ ] **CON-02.14** Overflow can only grow through allow-listed relayers (blocks debt-inflation griefing).

### Freeze
- [ ] **CON-02.15** `freezeMilestones()` / `unfreezeMilestones()` (guardian only) with events. `executeMilestone` reverts while frozen. Each freeze lapses automatically after 45 days (`MAX_FREEZE_DURATION`), the guardian may unfreeze earlier, and cumulative freeze time per project is capped at 90 days (`MAX_TOTAL_FREEZE`; after that `freezeMilestones` reverts). The inactivity clock is paused only for the frozen time elapsed (`effectiveDeadline = milestoneDeadline + frozenElapsed`, used by every deadline check). The 120-day refund path and `emergencyShutdown` keep working while frozen.

### Unchanged behaviour (regression targets)
- [ ] **CON-02.16** Deposit, `closeFundingAndStart` (5% fee), proportional token claims, `refundFailedCrowdfund`, `refundDeadProject`, `cancelProject`, `proposeNewDeveloper` / `acceptDeveloperRole`, `emergencyShutdown` (invalidate tokens, burn unvested, sweep ETH), `RevenueRouter` split, `P2PExchange` 1% fee.
- [ ] **CON-02.18** `ForgeCapitaRegistry`: treasury, guardian, relayer allow-list, `maxCostPerAction`, `l1Surcharge`, two-step rotation, bounded setters, events. Escrow, distributor, router, P2P and factory read roles from it.
- [ ] **CON-02.19** Fix v1 issues F1 (start the 120-day clock at `closeFundingAndStart`) and F2 (`completed` flag after the final milestone) from the design document.
- [ ] **CON-02.20 `[USER-ACTION]`** Move the deployer private key out of `.env` into Hardhat's keystore / `configVariable` before the v2 deployment (design finding F5).
- [ ] **CON-02.17** Optional: `multicall` on distributor/escrow for user-paid batching (claim yield + unstake). `[DEFERRED]` unless size allows.

## Phase 3: Tests & checks

- [ ] **CON-03.1** Hardhat tests: every signed action (valid, expired, wrong nonce, replayed, wrong chain, wrong contract, wrong signer, non-allow-listed relayer, ERC-1271 wallet).
- [ ] **CON-03.2** Gas ledger tests: under budget, exactly at budget, overflow, 15% cap across several milestones, final-milestone rule, per-action cap, relayer removed mid-project.
- [ ] **CON-03.3** Freeze tests: blocks execution, unfreeze, deadline behaviour, shutdown/refund still work while frozen.
- [ ] **CON-03.4** Regression suite for all unchanged behaviour (CON-02.16), including vote-lock and quorum edge cases.
- [ ] **CON-03.5** Fuzz/invariant tests: contract balances equal accounting; developer never receives more than release minus deduction; deduction never exceeds the cap.
- [ ] **CON-03.6** Contract size check (< 24 KB per contract), gas report, Slither (or equivalent) with findings triaged.
- [ ] **CON-03.7** Review checklist for signature handling and roles by a second pair of eyes before testnet deploy.

- [ ] **CON-03.8** First tests written against v1 behaviour: failing tests for F1 (refund possible right after funding closes) and F2 (refund possible on a completed project), plus a baseline regression suite for escrow, distributor, token, factory and P2P (only `RevenueRouter` has tests today; `npm test` is a stub — wire `npm test` to `hardhat test`).

- [ ] **CON-03.9** Gas report: measured gas units for `claimTokensFor`, `stakeWithPermit`, `voteBySig`, `executeMilestone` (final and non-final) so the per-chain minimum funding goal (design section 13) can be recalculated from measurements instead of estimates.

## Phase 4: Deployment & handover

- [ ] **CON-04.1 `[USER-ACTION]`** Provide a funded deployer key for both testnets (local use only, never in chat) and run the deployment yourself; Claude never deploys.
- [ ] **CON-04.2 `[USER-ACTION]`** Deploy v2 to Arbitrum Sepolia and BSC Testnet, verify on Arbiscan/BscScan, and record factory, P2P and implementation addresses plus start blocks in `docs/deployments-v2.md`.
- [ ] **CON-04.3 `[USER-ACTION]`** Fund the relayer address on both chains and allow-list it via the treasury wallet (script or explorer write).
- [ ] **CON-04.4** Sync ABIs: `node .claude/scripts/sync-abi.js indexer <Contract>` and `frontend <Contract>` for every changed contract.
- [ ] **CON-04.5** Update `business-model.md` and root `about.md` to describe the v2 gas model (already drafted in `about.md`; reconcile the final details).
- [ ] **CON-04.6** Smoke test on both testnets: launch → fund → close → gasless claim → gasless stake → gasless vote → gasless execute → recovery of overflow (force a tiny budget in a test project).

## Phase 5: Before mainnet (not scheduled)

- [ ] **CON-05.1 `[USER-ACTION]`** Independent security audit of signed actions, roles and the gas ledger.
- [ ] **CON-05.2** `[DEFERRED]` Move guardian to a multisig; timelock for role changes; bug bounty.
- [ ] **CON-05.3** `[DEFERRED]` ERC-4337 / EIP-7702 sponsorship for user-paid actions (invest, claim yield) if wanted later.
