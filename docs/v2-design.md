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
| F1 | `milestoneDeadline` is `0` until `startMilestone(0)` runs. `refundDeadProject` requires `projectCancelled \|\| block.timestamp > milestoneDeadline`, so it appears callable **as soon as funding closes**. | Backers can pull their pro-rata share back before the developer has even started milestone 0, and the escrow is drained while the project is "healthy". | Start the 120-day clock in `closeFundingAndStart`. |
| F2 | After the **final** milestone executes, `milestoneDeadline` is not cleared. 120 days later `refundDeadProject` is callable on a **completed** project; a holder who calls it surrenders tokens for roughly zero ETH. | Footgun for investors; also affects `isUserVoteLocked`. | Add a `completed` flag set at the final milestone; `refundDeadProject` and the deadline checks require `!completed`. |
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
| `DividendDistributor` | Add `stakeWithPermit(owner, amount, deadline, v, r, s)`: tries `permit` (ignores a front-run permit), then stakes for `owner`. Callable by anyone; if the caller is an allow-listed relayer it reports the sponsored cost to the escrow. Existing `stake`, `withdraw`, `claimYield` unchanged. Takes the registry address at `initialize`. |
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
used = gasAtEntry - gasleft() + 21000 + 16 * msg.data.length   // calldata bound
cost = min(used * tx.gasprice + l1Surcharge(action), maxCostPerAction)
```

Ceiling that bounds the platform's exposure: a sponsored call **reverts** when `gasSpent + cost > gasBudget + netFunds * MAX_DEBT_BPS / 10_000`, so everything the platform ever spends on a project is recoverable (total deductions across milestones are at most 15% of `netFunds`). The API then tells the user to self-pay. Direct (non-relayer) calls never touch the ledger.

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

The 120-day inactivity clock **pauses** during a freeze: every deadline check uses `effectiveDeadline = milestoneDeadline + frozenElapsed`, where `frozenElapsed = min(now, frozenAt + 45 days) - frozenAt` while a freeze is active, and `unfreezeMilestones()` adds the frozen time to `milestoneDeadline`. Without this a long freeze would push a founder into a deadlock they did not cause.

**Decision (2026-10-28, limits chosen by the assistant at the user's request): a freeze is bounded.** Each freeze lapses automatically after 45 days (`MAX_FREEZE_DURATION`), the admin can unfreeze earlier with `unfreezeMilestones()`, and total freeze time per project is capped at 90 days (`MAX_TOTAL_FREEZE`); after that `freezeMilestones()` reverts. Why these numbers: the compliance process (a warning, 14 days to escalation, a decision, and a possible takeover signalling vote and handover) fits inside 45 days, and the 90-day cap stops serial re-freezing from holding payouts indefinitely. They are contract constants, so changing them needs a redeploy. After the cap the remedies are the existing ones: shutdown, takeover, or letting the project continue.

The clock pause covers only the frozen time actually elapsed (up to the lapse). Residual risk: during a freeze investors cannot use `refundDeadProject` because the clock is paused, but no single freeze can last more than 45 days, so a lost or unresponsive admin key can no longer hold a project frozen forever. The developer can still call `cancelProject` and the admin can still call `emergencyShutdown` while frozen. The guardian key should still be a hardware wallet now and a multisig later (CON-05.2).

## 7. Events and ABI changes (indexer impact)

New events: `SponsoredGas(relayer, account, action, cost, gasSpent)`, `GasDebtRecovered(milestoneIndex, amount, outstanding)`, `GasDebtWrittenOff(amount)`, `MilestonesFrozen(by)`, `MilestonesUnfrozen(by, extension)`, `ProjectCompleted()`, registry events (`RelayerSet`, treasury and guardian rotation proposed / accepted, parameter changes). Changed signatures: `executeMilestone()` (no parameters), `Voted` unchanged. New functions listed in section 4.2. IDX-10 covers handling these.

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
| CON-01.5 | Does a freeze pause the inactivity clock? | Yes (section 6); 45 days per freeze (automatic lapse), 90 days cumulative per project. |
| CON-01.6 | Who may execute? | Anyone, once executable and not frozen. |
| CON-01.7 | Per-action cap and rate limit | Per-action cap in the registry; project ceiling from section 5; per-wallet rate limits live in the API, not on-chain. |

## 10. Test plan (summary of CON-03)

Write regression tests for all v1 behaviour first (there are none for escrow, distributor, token, factory, P2P), including failing tests for F1 and F2. Then: signature validity (valid, expired, wrong chain/contract/signer, ERC-1271 wallet, replay), ledger maths (under budget, at budget, overflow, 15% cap over several milestones, final-milestone write-off, ceiling revert, relayer removed mid-project), freeze (blocks execute, pauses the clock only for the elapsed frozen time, lapses after 45 days, 90-day cumulative cap, early unfreeze, refunds via `cancelProject` and shutdown still work), registry rotation, fuzz/invariants, contract size under 24 KB, gas report, Slither.

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

These are estimates, not measurements. Gas prices move and the Arbitrum L1 data fee dominates its cost, which is why the registry has a flat `l1Surcharge`. The minimum is a per-chain **configuration value** (native coin), recalibrated from the measured gas units and the API gas oracle's 24-hour average, not a constant baked into code. Testnet minimums may be set lower to make testing possible with faucet funds.

Enforcement:
- **Frontend:** the application and deploy forms reject a goal below the minimum for the selected chain and explain it (separate values for Arbitrum Sepolia and BSC Testnet).
- **API:** application review also validates it, so editing the form in the browser cannot bypass it.
- **On-chain:** not enforced. This is a usability rule, not a safety rule: the exposure ceiling in section 5 already caps the platform's loss. A project launched below the minimum by calling the factory directly simply stops being sponsored once its ceiling is reached, and its users pay their own gas.
