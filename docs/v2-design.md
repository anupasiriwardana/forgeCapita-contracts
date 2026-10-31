# ForgeCapita Contracts v2 — Design (gasless relayer)

Status: **approved by the user on 2026-10-28** with the changes recorded in section 12 (bounded freeze limits chosen at the user's request, section 12; minimum funding goal per chain, section 13). Written from a full read of the v1 sources (`MilestoneEscrow`, `DividendDistributor`, `ProjectToken`, `ForgeCapitaFactory`, `RevenueRouter`, `P2PExchange`). Backlog: `backlog-contracts.md`. v1 is archived by the `v1-testnet` git tag and `docs/deployments-v1.md`.

## 1. Goals and non-goals

Goals
- Four actions cost the user nothing: **claim tokens, stake, vote, execute milestone**. A ForgeCapita relayer wallet pays the gas. Plain MetaMask-style wallets work; no smart wallet is needed.
- Gas the platform spends is tracked **on-chain per project**: the 5% fee the treasury already receives is the budget; anything above it is recovered from milestone payouts, capped at 15% of each milestone release.
- The relayer is a limited hot wallet. Fees, shutdown and freeze stay with the treasury/admin wallet.
- Admin can freeze milestone payouts on-chain (replaces "withhold the signature").
- Everything else in v1 keeps working and stays user-paid: invest, claim yield, refund, create project, send revenue, unstake, P2P, approvals, start milestone, close funding.

Non-goals: ERC-4337 / EIP-7702 sponsorship, upgradeable proxies, changing the 5% / 24-1-75 / 1% fee splits, changing the voting rules.

## 2. Facts from the v1 code that shape the design

- `executeMilestone(gasDebt, signature)` has no caller restriction; the only gate is the treasury signature. Money goes to the developer (minus `gasDebt` to the treasury) regardless of who calls. So it can safely become **permissionless with no parameters**.
- `claimTokens()` transfers tokens to `msg.sender` = the depositor. A `claimTokensFor(account)` variant sends them to the same depositor, so it needs **no signature**.
- `vote(bool)` and `stake(uint256)` express a user's choice or move user tokens, so they **do need** the user's signature.
- `stake` pulls tokens with `transferFrom`, which needs an allowance. A gasless stake therefore needs ERC-2612 `permit` on `ProjectToken`.
- Roles are copied into each clone at `initialize` (`forgeCapitaTreasury`), and `P2PExchange.treasury` is `immutable`. A leaked or lost treasury key can never be rotated, and a relayer allow-list cannot be kept per project (it would need one transaction per project). Roles must live in **one shared contract**.
- `ReentrancyGuard`, `Initializable` and the OpenZeppelin 5.6.1 `EIP712` all work with EIP-1167 clones (the OZ domain separator is recomputed for the clone's own address).
- The treasury already receives the 5% fee at `closeFundingAndStart`; `netFunds = totalRaised - fee` funds all milestone releases.
- The test suite covers only `RevenueRouter` (`test/RevenueRouter.ts`); `npm test` is a stub. Escrow, distributor, token, factory and P2P have no tests yet.

## 3. v1 issues found while reading (fix in v2, confirm with tests first)

| # | Finding | Why it matters | v2 fix |
|---|---|---|---|
| F1 | `milestoneDeadline` is `0` until `startMilestone(0)` runs. `refundDeadProject` requires `projectCancelled \|\| block.timestamp > milestoneDeadline`, so it appears callable **as soon as funding closes**. | Backers can pull their pro-rata share back before the developer has even started milestone 0, and the escrow is drained while the project is "healthy". | Superseded 2026-10-28: the 120-day deadline is removed entirely, so `refundDeadProject` requires `projectCancelled`. |
| F2 | After the **final** milestone executes, `milestoneDeadline` is not cleared. 120 days later `refundDeadProject` is callable on a **completed** project; a holder who calls it surrenders tokens for roughly zero ETH. | Footgun for investors; also affects `isUserVoteLocked`. | Add a `completed` flag set at the final milestone; `refundDeadProject` requires `!completed` (the deadline checks no longer exist). |
| F3 | Treasury, relayer-like roles cannot be rotated (see section 2). | Key compromise or key loss is permanent for every project. | Shared registry with two-step rotation (section 4). |
| F4 | `P2PExchange.treasury` is immutable and independent of the factory registry. | Same as F3 for secondary-market fees. | Read treasury from the registry. |
| F5 | Hardhat config loads `PRIVATE_KEY` and RPC URLs from `.env` via `dotenv`. | Every `hardhat compile` / `test` loads the deployer key into the process. | Use Hardhat's keystore / `configVariable` for the deployer key before the v2 deployment `[USER-ACTION]`. |

F1 and F2 are read from the code, not yet reproduced; the first v2 tests (CON-03.4) must write them as failing tests against the v1 behaviour. They also affect already-launched v1 testnet projects (v1 is not being migrated).

## 4. Architecture

### 4.1 New: `ForgeCapitaRegistry` (one per deployment)

Holds the roles and sponsorship parameters for every project, and is read by escrow, distributor, router, P2P and factory.

| Item | Detail |
|---|---|
| `treasury()` | Fee recipient. |
| `guardian()` | Emergency shutdown, freeze/unfreeze, `proposeNewDeveloper`, relayer and parameter management. Same address as the treasury at launch (one admin wallet); a separate variable so it can move to a multisig later. |
| `isRelayer(address)` | Allow-list of relayer wallets, managed by the guardian. |
| `maxCostPerAction()` | Hard cap on what one sponsored action may add to a project's ledger (wei). |
| `l1Surcharge(action)` | Flat per-action addition for chains where the L1 data fee is not visible in `tx.gasprice` (Arbitrum). Zero on BSC. |
| Rotation | `proposeTreasury` / `acceptTreasury`, `proposeGuardian` / `acceptGuardian` (two-step, events). Parameter setters have hard upper bounds. |

Reading the registry costs one extra call per privileged check; negligible next to the actions.

### 4.2 Changes per contract

| Contract | Changes |
|---|---|
| `ProjectToken` | Add ERC-2612 `permit` (OZ `ERC20PermitUpgradeable`), overridden with the same `checkValidity` guard as `approve` so permits cannot be used after an emergency shutdown. |
| `DividendDistributor` | Add `stakeWithPermit(owner, amount, deadline, v, r, s)`: tries `permit` (ignores a front-run permit), then stakes for `owner`. Callable by anyone; if the caller is an allow-listed relayer it reports the sponsored cost to the escrow. When the caller is an allow-listed relayer it calls `escrow.recordSponsoredGas(relayer, account, action, cost)`, which the escrow accepts only from its own distributor. Existing `stake`, `withdraw`, `claimYield` unchanged. Takes the registry address at `initialize`. |
| `MilestoneEscrow` | Add `claimTokensFor(account)`, `voteBySig(...)`, parameterless `executeMilestone()`, gas ledger, freeze, `completed` flag (F2), clock start at close (F1), roles read from the registry. Keep `claimTokens()`, `vote(bool)`. |
| `RevenueRouter` | Read `treasury` from the registry (claim target). Split logic unchanged. |
| `P2PExchange` | Read `treasury` from the registry. Logic unchanged. |
| `ForgeCapitaFactory` | Constructor takes the registry; passes it to every clone. Logic otherwise unchanged. |

### 4.3 Who signs, who submits

| Action | User signs | Relayer calls | Self-pay fallback (always works) |
|---|---|---|---|
| Claim tokens | nothing (the API authenticates the logged-in account) | `claimTokensFor(account)` | `claimTokens()` |
| Stake | one ERC-2612 `Permit` for the distributor | `stakeWithPermit(...)` | `approve` + `stake` |
| Vote | one EIP-712 `Vote(voter, milestoneIndex, support, deadline)` | `voteBySig(...)` | `vote(bool)` |
| Execute milestone | nothing | `executeMilestone()` | anyone may call it |

Signature rules: domain `{name, version, chainId, verifyingContract = clone address}`; `SignatureChecker` (ECDSA with malleability protection, plus ERC-1271 so smart wallets can sign); `deadline` required. The vote signature needs no nonce because `hasVoted[milestoneIndex][voter]` already allows one vote per milestone. The permit uses the token's own nonce.

## 5. Gas ledger

Per project, in `MilestoneEscrow`:

```
gasBudget     = platform fee collected at closeFundingAndStart   // the 5%, already paid to the treasury
gasSpent      += cost of each relayer-submitted action
gasRecovered  += amount deducted from milestone payouts
```

Cost of one sponsored action (only recorded when `msg.sender` is an allow-listed relayer):

```
used = gasAtEntry - gasleft() + overhead(action) + 21000 + 16 * msg.data.length   // calldata bound
cost = min(used * tx.gasprice + l1Surcharge(action), maxCostPerAction)
```

Measurement approach (CON-02.23): `gasleft()` is read at the very end of `claimTokensFor`, `voteBySig` and `stakeWithPermit`, after all state changes and external calls, so the measured part covers the whole body. `overhead(action)` is a named constant in `SponsoredGasCost` (`CLAIM_OVERHEAD`, `VOTE_OVERHEAD`, `STAKE_OVERHEAD`) for the work that cannot be measured from inside the call: dispatcher and reentrancy-guard entry, the cost lookups, the booking write, the event and the exit. The constants are calibrated against the steady-state measurements and are lower bounds, so booked gas does not exceed the gas actually paid. `executeMilestone` must know its cost before computing the deduction, yet the payouts run after the deduction. It therefore measures up to the booking point and adds a fixed constant for the payout tail (`EXECUTE_OVERHEAD`, plus `EXECUTE_FINAL_EXTRA` for the final milestone, which vests tokens and emits `ProjectCompleted`). This keeps the cost inside the same call and the deduction exact, depends on no user-controlled input, and leaves the ledger monotonic; booking the cost into the next settlement was rejected because the final milestone has no next settlement. Constants are fixed values, so a code change that shifts gas moves booked versus actual; `test/GasMeasurement.ts` fails if booked exceeds actual or falls below 95% of actual (70% for first-in-project calls, which pay one-off cold and first-write costs). Rare paths that cost less than the calibrated case (for example a claim to an account that already holds tokens) can be booked slightly above actual; the per-action cap and the 15% recovery cap still bound this.

Ceiling that bounds the platform's exposure: a sponsored call **reverts** when `gasSpent + cost > gasBudget + netFunds * MAX_DEBT_BPS / 10_000`, so everything the platform ever spends on a project is recoverable (total deductions across milestones are at most 15% of `netFunds`). The API then tells the user to self-pay. Direct (non-relayer) calls never touch the ledger. Before funding closes the ceiling is 0, so costly relayer calls revert with "Gas ceiling exceeded". Registry `maxCostPerAction` and `l1Surcharge` default to 0 and must be set by the guardian at deployment, together with allow-listing the relayer.

Recovery in `executeMilestone()`:

```
ethToRelease = netFunds * unlockPercentage / 100
overflow     = max(0, gasSpent - gasBudget)
outstanding  = overflow - gasRecovered
deduction    = min(outstanding, ethToRelease * 1500 / 10_000)    // 15% cap
treasury gets deduction; developer gets ethToRelease - deduction
gasRecovered += deduction
```

At the final milestone any `outstanding` left after the deduction is **written off** (event `GasDebtWrittenOff`); the developer's 20% token vesting is untouched. The `MilestoneExecuted` event keeps its v1 shape (the last field now carries the deduction) so the existing indexer handler keeps working.

## 6. Freeze

`freezeMilestones()` / `unfreezeMilestones()` (guardian only, events). While frozen, `executeMilestone()` reverts; voting, staking, refunds and `emergencyShutdown` keep working.

The 120-day inactivity deadline was removed on 2026-10-28 (section 12), so a freeze needs no clock pause. A freeze only blocks `executeMilestone()`.

As built (WS-04.6): state `freezeStart`, `frozenUntil`, `totalFrozen`; view `isFrozen()` (`freezeStart != 0 && now < frozenUntil`), so a freeze lapses with no transaction. A new freeze lasts `min(45 days, 90 days - settled)`; a lapsed freeze is added to `totalFrozen` when the next `freezeMilestones()` settles it, so the `totalFrozen` getter can under-report by up to 45 days until then. An early unfreeze adds only the elapsed time. Calling freeze while frozen reverts ("Already frozen"); freeze also reverts before funding closes, on a cancelled or completed project, and once 90 days are used ("Freeze limit reached"); unfreeze reverts with "Not frozen" when no freeze is active.

**Decision (2026-10-28, limits chosen by the assistant at the user's request): a freeze is bounded.** Each freeze lapses automatically after 45 days (`MAX_FREEZE_DURATION`), the admin can unfreeze earlier with `unfreezeMilestones()`, and total freeze time per project is capped at 90 days (`MAX_TOTAL_FREEZE`); after that `freezeMilestones()` reverts. Why these numbers: the compliance process (a warning, 14 days to escalation, a decision, and a possible takeover signalling vote and handover) fits inside 45 days, and the 90-day cap stops serial re-freezing from holding payouts indefinitely. They are contract constants, so changing them needs a redeploy. After the cap the remedies are the existing ones: shutdown, takeover, or letting the project continue.

Residual risk: no single freeze can last more than 45 days, so a lost or unresponsive admin key can no longer hold a project frozen forever. The developer can still call `cancelProject` and the admin can still call `emergencyShutdown` while frozen. The guardian key should still be a hardware wallet now and a multisig later (CON-05.2).

## 7. Events and ABI changes (indexer impact)

As built after WS-04.7c (2026-10-30): also new event `MilestoneFailed(uint256 index)` (not indexed), getters `cancelledAt()` and `REFUND_WINDOW()` (90 days), `ProjectToken.burn` is owner-only (the escrow), `executeMilestone()` no longer reverts after the voting end (it cancels a failed milestone), and new revert strings "Voting period ended", "Already shut down", "Refunds still open" (replaces "Project already cancelled" in `emergencyShutdown`) and "Permit failed". There is no `extendVoting` / `VotingExtended`.

New events: `SponsoredGas(relayer, account, action, cost, gasSpent)` (`action` is a `uint8`: Claim=0, Stake=1, Vote=2, Execute=3; `account` is address(0) for execute), `GasDebtRecovered(milestoneIndex, amount, outstanding)`, `GasDebtWrittenOff(amount)`, `MilestonesFrozen(until, totalFrozen)`, `MilestonesUnfrozen(totalFrozen)` (no `by` address; the guardian is implied, the transaction sender shows who), `ProjectCompleted()`, registry events (`RelayerSet`, treasury and guardian rotation proposed / accepted, parameter changes). Changed signatures: `executeMilestone()` (no parameters), `Voted` unchanged. New functions listed in section 4.2. IDX-10 covers handling these.

## 8. Threat model (summary)

| Threat | Mitigation |
|---|---|
| Relayer key stolen | It can only call permissionless claim/execute, submit signatures users already produced, and spend its own ETH. Ledger exposure is bounded by the ceiling in section 5. Revoke with `setRelayer(addr, false)`; one transaction covers all projects. |
| Treasury/guardian key stolen | Full control of shutdown, freeze and fees. Mitigated by hardware wallet now, multisig later (CON-05.2) and two-step rotation. |
| Signature replay | Domain binds chain and clone address; votes are one-per-milestone; permits use the token nonce; every signature has a deadline. |
| Front-running a signature | Harmless: the same vote or stake happens, the front-runner pays the gas. The relayer's later call reverts and the API treats the request as completed. |
| Griefing the ledger | Only allow-listed relayers record cost; per-action cap; project-level ceiling. |
| Malicious smart-wallet signer (ERC-1271 reentrancy) | `nonReentrant` on all state-changing paths that verify signatures. |
| Rounding/accounting drift | Invariant tests: balances equal accounting; deduction never exceeds the cap. |

## 9. Decisions (proposed answers to the backlog's open questions)

| Backlog | Question | Proposal |
|---|---|---|
| CON-01.2 | `BySig` functions or an ERC-2771 forwarder? | Per-function entry points. Only two need a signature (vote, permit); claim and execute need none. Smaller surface, no trusted forwarder. |
| CON-01.3 | Gas measurement and the Arbitrum L1 fee | Measure `gasleft()` plus a calldata bound, times `tx.gasprice`, plus a flat guardian-set `l1Surcharge`, capped per action. Revisit the ArbGasInfo precompile later if the flat surcharge proves inaccurate. |
| CON-01.4 | Overflow left after the final milestone | Write it off; do not touch the 20% developer tokens. |
| CON-01.5 | Does a freeze pause the inactivity clock? | Moot: the deadline was removed. Freeze limits kept: 45 days per freeze (automatic lapse), 90 days cumulative per project. |
| CON-01.6 | Who may execute? | Anyone, once executable and not frozen. |
| CON-01.7 | Per-action cap and rate limit | Per-action cap in the registry; project ceiling from section 5; per-wallet rate limits live in the API, not on-chain. |

## 10. Test plan (summary of CON-03)

Write regression tests for all v1 behaviour first (there are none for escrow, distributor, token, factory, P2P), including failing tests for F1 and F2. Then: signature validity (valid, expired, wrong chain/contract/signer, ERC-1271 wallet, replay), ledger maths (under budget, at budget, overflow, 15% cap over several milestones, final-milestone write-off, ceiling revert, relayer removed mid-project), freeze (blocks execute, lapses after 45 days, 90-day cumulative cap, early unfreeze, refunds via `cancelProject` and shutdown still work), registry rotation, fuzz/invariants, contract size under 24 KB, gas report, Slither.

## 11. Impact on other repos

- **API:** claim needs no wallet signature (authenticated session); execute is submitted automatically; vote uses an EIP-712 `Vote` signature; stake uses an ERC-2612 permit. `API-72` and `FE-40` are updated accordingly.
- **Indexer:** new events (IDX-10); new addresses and start blocks after deployment (IDX-21); the factory and registry addresses may differ per chain because the deployer's transaction counts differ.
- **Frontend:** only `Vote` and `Permit` need a MetaMask signature popup; claim and execute are one click with no popup.

## 12. Decisions confirmed by the user (2026-10-28)

1. **Registry (section 4.1):** approved.
2. **Freeze (section 6):** the user first asked for no limit, then asked the assistant to choose the best bounded option: 45 days per freeze with automatic lapse, 90 days cumulative per project.
3. **Exposure ceiling (section 5):** approved (5% budget plus 15% of net funds).
4. **Final-milestone write-off:** approved, together with a minimum funding goal per chain so that 5% covers the sponsored gas (section 13).
5. **F1 and F2:** approved. Fix both in v2 and write the failing tests first.
6. **On-chain launch approval:** not added. Rogue-deployment detection stays off-chain.
7. **120-day deadline removed (2026-10-28):** `MAX_INACTIVITY_PERIOD` and `milestoneDeadline` no longer exist; a hardcoded limit is wrong for large projects. `refundDeadProject` now requires `projectCancelled`. A stalled developer is handled by the guardian (`emergencyShutdown` or `proposeNewDeveloper`). CON-02.21 (late start) is therefore not applicable. Consequence: investors have no permissionless exit unless the developer calls `cancelProject`, and voters stay vote-locked while a vote is open on a stalled project.
8. **Shutdown of a completed project:** the guardian may still `emergencyShutdown` a completed project.
9. **Guardian cancel (2026-10-28):** `cancelProject` is callable by the developer or the registry guardian, so a stalled project can be cancelled by the admin and investors refund pro-rata through `refundDeadProject` without the ETH being swept to the treasury. `cancelProject` now reverts if the project is already cancelled (including after `emergencyShutdown`) or completed. The `ProjectCancelled(string)` event is unchanged and does not record who cancelled. Stakers must withdraw from the distributor before refunding.

## 13. Minimum funding goal per chain

The 5% fee is the gas budget, so the funding goal must be large enough for 5% to pay the sponsored gas of a full project. Sizing assumption: **100 investors and 5 milestones**, plus a 50% margin.

Sponsored transactions per project: each investor claims once, stakes once and votes on each milestone, and each milestone is executed once: `100 x (1 + 1 + 5) + 5 = 705`.

```
sponsoredGas = N * (G_claim + G_stake + M * G_vote) + M * G_execute
cost         = sponsoredGas * gasPrice + 705 * l1Surcharge
minGoal      = cost * (1 + margin) / 0.05
```

Illustrative gas-unit estimates (to be replaced by measured values from the gas report, CON-03.9): claim 80k, stake with permit 150k, vote by signature 100k, execute 150k, giving about 73.75M gas per project.

| Chain | Assumptions | Cost per project | With 50% margin | Minimum goal |
|---|---|---|---|---|
| BSC Testnet | 1 gwei gas price, no L1 fee | 0.074 BNB | 0.11 BNB | about 2.2 BNB (about 6.6 BNB at 3 gwei) |
| Arbitrum Sepolia | 0.1 gwei L2 gas price (0.0074 ETH) plus about 0.00006 ETH L1 data fee per transaction (about 0.045 ETH) | 0.052 ETH | 0.079 ETH | about 1.6 ETH |

**Recalibration pointer (added with WS-04.7, 2026-10-28; the figures in this section are left unchanged):** the gas units are now measured, giving about 85.0M gas per project instead of 73.75M, and minimum goals of about 2.55 BNB (1 gwei), 7.65 BNB (3 gwei) and 1.52 ETH (Arbitrum Sepolia). After the end-of-call booking (CON-02.23) the ledger books about 97.5% of the real gas in steady state (a remaining gap of about 1.5k to 4.7k gas per action; first-in-project claims are booked at 74% on purpose; only an execute that also makes a deduction is booked well below actual), and the minimum goals above were re-checked on 2026-10-28 (CON-03.12) and stay valid at that precision (85,020,820 gas). Suggested `maxCostPerAction` and `l1Surcharge` values are re-derived in section 5 of the measurements document. See [gas-measurements-v2.md](gas-measurements-v2.md). Gas prices and the L1 fee remain estimates.

**Decision 2026-10-28:** the minimum goal is not a fixed number. The API computes it live from the current smoothed gas price (plus the Arbitrum L1 fee estimate), the measured gas units, N, M and a margin (default 50%), with optional floor and ceiling, all admin-adjustable config (API-41); the frontend displays it (FE-53). The tables above are illustrative reference points only.

These are estimates, not measurements. Gas prices move and the Arbitrum L1 data fee dominates its cost, which is why the registry has a flat `l1Surcharge`. The minimum is a per-chain **configuration value** (native coin), recalibrated from the measured gas units and the API gas oracle's 24-hour average, not a constant baked into code. Testnet minimums may be set lower to make testing possible with faucet funds.

Enforcement:
- **Frontend:** the application and deploy forms reject a goal below the minimum for the selected chain and explain it (separate values for Arbitrum Sepolia and BSC Testnet).
- **API:** application review also validates it, so editing the form in the browser cannot bypass it.
- **On-chain:** not enforced. This is a usability rule, not a safety rule: the exposure ceiling in section 5 already caps the platform's loss. A project launched below the minimum by calling the factory directly simply stops being sponsored once its ceiling is reached, and its users pay their own gas.

## 14. Failed milestone vote and the discussion room (decided 2026-10-30, from the second reviewer's finding, CON-03.7)

**Problem.** In the built v2 contract a vote that does not pass is never finalised: the milestone stays open (and `vote()` has no end time), and refunds open only after `cancelProject` or `emergencyShutdown`. An honest developer who needs a retry has no path, and investors have no permissionless exit from a rejected milestone.

**Decision.**

1. **Off-chain pre-vote room (API + frontend, no contract support, no gas).** The developer states an estimated date for each milestone after funding closes. On that date the developer submits the work, which opens a discussion room for at least 30 days. The first version is threaded comments plus three polls: request cancellation, request developer replacement, accept the design. Live chat can come later.
   - Membership: only investors who join the room after the submission. Votes in every poll are weighted by tokens and tied to the verified account (not one person, one vote).
   - Early close: allowed only when every joined member has accepted, the joined members hold at least the quorum share (20%) of the public supply, and at least 14 days have passed.
   - The developer may revise the submission in the room; accept votes apply to the latest version and reset when it changes.
   - The polls are advisory. The contract cannot read them; the admin enacts the outcome with `cancelProject` and `proposeNewDeveloper`, which already exist.
   - If a milestone date passes with no submission, investors can open the cancel and replace polls anyway and the admin is notified.
   - The room is not enforced on-chain: a developer can call `startMilestone` directly. The 28-day vote is still the real protection, and the API flags a vote started without a room.
2. **On-chain vote, one attempt.** After the room closes the developer calls `startMilestone`. There is no on-chain retry (a retry costs more sponsored votes).
3. **Failure handling inside `executeMilestone()`, no new function.** A transaction that reverts cannot also save state, so the failed case must not revert. When voting has ended (the fixed 28 days) and the milestone has not passed (quorum reached and yes > no, or the over-50% fast track), the call sets `projectCancelled = true`, emits a `MilestoneFailed(index)` event and returns without paying anyone. Investors then use `refundDeadProject` pro-rata on what is left in the escrow (earlier payouts stay with the developer). While voting is still open and the milestone cannot yet be decided, the call reverts as today. The failure path is not blocked by a freeze (cancelling already works while frozen); the payout path still is. `vote` and `voteBySig` revert after the voting end so the result is final (the end is exclusive: a vote reverts from `votingStartTime + 28 days` onward, the same second `executeMilestone` can finalise).
4. **No on-chain extension (dropped 2026-10-30, user decision).** A developer-requested `extendVoting` was considered and dropped: the room already engages the investors who care, an extension changes nobody's vote, and a developer could use it to delay a refund by up to 60 days. Voting is a fixed 28 days. Low turnout is addressed off-chain: the API reminds members who have not voted (for example at days 7, 14, 21 and 26).
5. **Trade-offs.** An unresponsive electorate (no quorum after the 28 days) counts as a failure. A large "no" bloc can end a project, with investors refunded pro-rata. The relayer cost of a failed finalisation is booked to the ledger but no later milestone payout can recover it, so it is absorbed by the 5% budget.

Impact: contracts (`executeMilestone`, `_vote`, `MilestoneFailed` event, tests), indexer (`MilestoneFailed`), API (milestone schedule, submissions, room, polls, vote reminders, flags), frontend (schedule form, room, vote and refund states).

## 15. Emergency shutdown after a cancel, and the shutdown payout (decided 2026-10-30, second reviewer's finding 3)

**Problem.** `emergencyShutdown` reverts when the project is already cancelled ("Project already cancelled"). After a cancel and the investors' refunds, nothing invalidates the token or burns the tokens that the refunds left in the escrow, so the worthless token stays tradable (P2P) and stakeable.

**Decision.**

1. **[CHANGED 2026-10-31, section 17: a non-cancelled, non-completed project now reverts "Cancel project first"]** Before: `emergencyShutdown` on a project that is not cancelled works exactly as before (guardian only; invalidates the token, burns the tokens held by the escrow, sweeps the remaining ETH to the treasury).
2. **New:** on a project that is already cancelled (by the developer, by the guardian, or by a failed vote) the guardian may call `emergencyShutdown` only when `remainingPublicTokens == 0` (every public token has been refunded) or at least 90 days have passed since the cancel (`REFUND_WINDOW = 90 days`). Otherwise it reverts ("Refunds still open"). This keeps the guarantee that a refund pool cannot be swept while holders can still claim it, and it stops the shutdown from invalidating the token (which blocks `refundDeadProject`'s `transferFrom`) before refunds are done.
3. **Implementation notes:** one new storage value, `cancelledAt`, set in every path that sets `projectCancelled` (`cancelProject`, the failure path of `executeMilestone`, and shutdown itself). A second shutdown must revert ("Already shut down", for example via `projectToken.isInvalidated()`). No new function.
4. **[DROPPED 2026-10-31, see section 17] Shutdown payout (off-chain, frontend + API + indexer).** The swept ETH sits in the treasury wallet; getting it back to the investors is an admin action built into the admin area:
   - Basis (confirmed by the user 2026-10-30, because P2P trading can occur; handled off-chain so it costs no contract gas): the same maths as `refundDeadProject`, `payout = tokenWeight * swept / remainingPublicTokens`, where `tokenWeight` is measured at the shutdown block and covers tokens held in wallets, tokens staked in the distributor, tokens locked in P2P listings (credited to the seller) and tokens an investor never claimed (deposit * publicSupply / totalRaised). Paying original depositors instead would pay a seller twice and cheat a P2P buyer. Simpler fallback if P2P trading is rare: pay by `deposits`.
   - The indexer provides the holder snapshot; the API stores the payout plan and a per-investor status (pending, sent with tx hash, confirmed, failed) and reconciles the total against the swept amount (the `EmergencyShutdownTriggered` event); the frontend admin page shows the plan, lets the admin adjust the amount to distribute (for example to keep documented costs), and sends the transfers from the admin's own wallet (the browser wallet signs; the server never holds the treasury key). With about 100 investors this is up to 100 transfers from the admin wallet unless the treasury is a multisig with batching.
   - Investors see their expected payout and its status on their page. A recipient that rejects ETH is flagged for manual handling. All amounts use bigint; rounding dust stays in the treasury.
   - Open option for later (needs a contract change, not decided): a pull-based payout, where the admin funds a payout pool and investors claim, would remove the N admin transactions and the dependence on the admin sending.
   - The admin is trusted to execute the plan; the audit trail and reconciliation make a missing or partial payout visible.

## 16. Smaller reviewer findings (decided 2026-10-30)

1. **Gas ceiling reached (finding 4).** Behaviour kept: a relayer-submitted call reverts ("Gas ceiling exceeded") for that project only, and the user pays their own gas for any action. The user decided against extra API rules (soft reserve for votes, no sponsoring past the 5% budget before the first payout, pre-send simulation with a "free gas left" display): the 5% fee budget plus up to 15% of each milestone payout is considered enough. Only one change is adopted: the failure branch of `executeMilestone()` (section 14) does not record gas, so the ceiling can never block a cancellation after a failed vote. The platform absorbs that small cost.
2. **Public `ProjectToken.burn` (finding 5).** `burn(uint256)` lets any holder burn their own tokens without `MilestoneEscrow.remainingPublicTokens` changing. `refundDeadProject` divides by `remainingPublicTokens`, so the burner's slice of the refund pool is never claimed and stays in the escrow (it is only reachable by the guardian sweep after the refund window, section 15). The only caller in the contracts is the escrow's `emergencyShutdown` (burning its own held tokens). Recommended fix (queued in WS-04.7c, user may change it): restrict `burn` to the token owner (the escrow), so holders cannot burn; shutdown still works. The test that has a holder burning tokens (`test/ProjectToken.ts`) is replaced by: owner burn works, holder burn reverts.
3. **Permissionless `claimTokensFor` (finding 6).** Accepted as designed: the tokens can only go to the depositor, each account can claim once, and a non-relayer caller pays their own gas, so a stranger can only deliver an investor's own tokens to the investor. Only annoyance: a front-run claim makes the investor's own `claimTokens()` revert with "Tokens already claimed". The frontend checks `hasClaimedTokens` first and treats "already claimed" as success. No contract change.
4. **`stakeWithPermit` swallows every permit failure (finding 7).** The try/catch is needed so a front-run permit does not break the stake, but it also lets a stranger with a junk signature stake an owner's tokens when the owner has a standing allowance to the distributor (for example an unlimited approval left over from the self-pay path). Adopted (option B): if the permit call fails, only the owner or an allow-listed relayer may continue using the existing allowance; anyone else reverts ("Permit failed"). Front-run case unchanged for the relayer. The `isRelayer` result is read once and reused for the gas recording. No new function. The frontend self-pay path should approve the exact amount, never unlimited.
5. **Repeat of finding 5.** The reviewer's later finding about the public `ProjectToken.burn` is the same issue as item 2 above and needs no further change.

## 17. Third reviewer round (decided 2026-10-31, WS-04.7d)

1. **Goal met but the developer never closes funding.** Before: nobody could act (`closeFundingAndStart` is developer-only, `refundFailedCrowdfund` needed `balance < fundingGoal`, `cancelProject` needed funding closed). Now: constant `CLOSE_GRACE = 14 days`. `closeFundingAndStart` also requires `block.timestamp <= fundingDeadline + CLOSE_GRACE` ("Close window ended"). `refundFailedCrowdfund` is allowed when `(balance < fundingGoal && now > fundingDeadline) || now > fundingDeadline + CLOSE_GRACE`; deposits are refunded in full with no fee (the fee is only taken on close). While the deadline has passed, the goal was met and the grace is open, it reverts "Close window still open". Frontend and API: show the refund state "goal met, deadline passed, grace over".
2. **Freeze during a vote.** A freeze extends the vote. `frozenAtVoteStart[index]` records the total frozen time when a milestone's voting opens; the vote end is `votingStartTime + VOTING_PERIOD + (frozen time now - frozenAtVoteStart[index])`, exposed as the view `votingEndTime(index)` and used by both `_vote` and `executeMilestone` (exclusive boundary). Frozen time counts only the part actually frozen (early unfreeze, lapse, 90-day cap). A passing vote stays blocked from payout while frozen; a vote that has already ended is not revived by a later freeze. Frontend and API show `votingEndTime`, not `votingStartTime + 28 days`.
3. **Emergency shutdown only after a cancel (changes section 15).** `emergencyShutdown` on a project that is neither cancelled nor completed reverts "Cancel project first". The guardian cancels (`cancelProject`), investors pull refunds for `REFUND_WINDOW` (90 days), then shutdown invalidates the token, burns the escrow's tokens and sweeps what is left to the treasury (leftovers of holders who never refunded). A completed project keeps the immediate shutdown (it still sets `projectCancelled` and `cancelledAt`; the user decided on 2026-10-31 to keep this as is, so the indexer and frontend must treat a shut-down completed project as completed first). Funding-phase projects are handled by item 1.
4. **Shutdown payout dropped.** Section 15 item 4 (off-chain payout: indexer holder snapshot, API plan, frontend admin transfers) is **not built**. Refunds are on-chain and pull-based through `refundDeadProject`; holders who miss the 90 days forfeit their share to the treasury. Reminders go through the API and frontend, and tokens staked in the distributor must be unstaked first.
5. **Gasless refund rejected.** Refunds stay user-paid: there is no gas budget to recover from (a failed crowdfund takes no fee, a cancelled project pays nothing out), a token refund would need a permit and an unstake, and a contract wallet that rejects ETH would waste the relayer's gas.
