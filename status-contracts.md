# ForgeCapita Contracts — Service Status & Technical Health Report

**Service:** `forgecapita-contracts` (Solidity / Hardhat 3, OpenZeppelin clones)
**Networks:** Arbitrum Sepolia (`421614`) and BSC Testnet (`97`)
**Last Updated:** 2026-10-28
**Location of this file:** moved here from the workspace root on 2026-10-28.

**Current focus:** Step: WS-04.3b | State: awaiting-review | Updated: 2026-10-28

---

## 1. Executive Summary

**v1 is deployed to both testnets and frozen.** v2 (gasless relayer) is **planned, not started**. The v2 plan is in `backlog-contracts.md`. The freeze was lifted on 2026-10-28 (CON-00.1, CON-00.3 done, verified by hook probes): contracts may be edited, compiled and tested; deployment stays a user action. v1 addresses are recorded in `docs/deployments-v1.md` (CON-00.2, address half). The `v1-testnet` git tag exists. The v2 design draft `docs/v2-design.md` was written and **approved by the user on 2026-10-28** (changes: freeze limits of 45 days per freeze and 90 days cumulative; a per-chain minimum funding goal, section 13). It also lists two apparent v1 bugs (F1: `refundDeadProject` appears callable right after funding closes because `milestoneDeadline` starts at 0; F2: it becomes callable on a completed project) that are now confirmed by failing tests (see the update below and section 4a).

**Update 2026-10-28 (WS-04.3b, awaiting review):** `ForgeCapitaRegistry` (treasury, guardian, relayer allow-list, `maxCostPerAction`, `l1Surcharge`, two-step rotation) exists, and the factory, escrow, distributor, router and P2P exchange read roles from it at call time. F1 and F2 are fixed in v2 (v1 is unchanged and deployed). Compile clean; `npm test`: **187 passing, 0 failing**. Not deployed. The Ignition modules and `scripts/` are stale (still deploy the old factory). **Follow-up 2026-10-28 (user decisions):** the 120-day inactivity deadline (`milestoneDeadline`, `MAX_INACTIVITY_PERIOD`) is removed from `MilestoneEscrow`; `refundDeadProject` keeps its name but requires `projectCancelled`. A stalled developer is handled by guardian `emergencyShutdown` or `proposeNewDeveloper`. CON-02.21 (late start) is resolved as no longer applicable, and the freeze needs no clock pause. The guardian may `emergencyShutdown` a completed project (accepted). Then, by user decision, `cancelProject` was opened to the guardian too (CON-02.22). Now **195 passing, 0 failing**, MilestoneEscrow 11950 bytes. ABI change: getters `milestoneDeadline()` and `MAX_INACTIVITY_PERIOD()` are gone (sync in WS-05). Next: WS-04.4 (signed actions and permit).

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

Phase 2: CON-02.1 to CON-02.4, CON-02.18 and CON-02.19 are done (WS-04.3b). CON-02.21 is resolved by removal of the inactivity deadline. Remaining: CON-02.5 to CON-02.16, CON-02.20 (user). CON-03.8 is done. Next: WS-04.4 (signed actions and permit). CON-03.9 (gas report) is deferred to WS-04.7.

## 4a. Test baseline (updated WS-04.3b, 2026-10-28)

After the guardian-cancel follow-up (2026-10-28), tracker-verified: `npm test` **195 passing, 0 failing**, MilestoneEscrow **11950 bytes**. (Previous: deadline removal, 189 passing, 11761 bytes.) The paragraph and size list below are the first WS-04.3b measurement (187 passing, MilestoneEscrow 12078); only MilestoneEscrow's size changed since.
After WS-04.3b, tracker-verified: `npx hardhat compile` clean, `npm test` **187 passing, 0 failing** (was 144 passing, 2 failing). New files: `test/ForgeCapitaRegistry.ts` (25 tests), `test/RegistryIntegration.ts` (12), `test/regressions-v1-fixes.ts` (replaces `known-issues-v1.ts`; F1 and F2 tests kept, now green). Two revert strings in existing tests changed to "Only active dev or Guardian can propose" and "Only Guardian can trigger emergency shutdown" (role rename; the test files are untracked so no git diff exists to compare, only skimmed). `test/RevenueRouter.ts` was extended.
Deployed bytecode sizes re-measured from artifacts (limit 24576): ForgeCapitaRegistry 1625, MilestoneEscrow 12078 (now 11761 after the follow-up), ForgeCapitaFactory 3283, RevenueRouter 2294, P2PExchange 2563, DividendDistributor 3170, ProjectToken 4212.

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
5. [ ] Rest of CON-02 implementation, CON-03.1 to CON-03.7 and CON-03.9 (WS-04.7).
6. [ ] `[USER-ACTION]` CON-04 deploy to both testnets, fund and allow-list the relayer.

---

## Change log

2026-10-28  WS-04.3b (guardian cancel)  `MilestoneEscrow.cancelProject` now callable by developer or `registry.guardian()` (revert "Only developer or Guardian can cancel"); new guards "Project already cancelled" and "Project is completed"; `ProjectCancelled(string)` unchanged (no ABI signature change); tests added; CON-02.22 added and ticked; CON-04.7(a) done, (b) stale docs still open. Trust note: the guardian can now cancel any funded, non-completed project; unvested developer tokens stay in escrow after cancel; stakers must unstake before refunding  - verified by: tracker re-ran `npm test` (195 passing, 0 failing), measured MilestoneEscrow 11950 bytes from the artifact, read `MilestoneEscrow.sol` lines ~355-370 (not the full diff or the new test bodies)

2026-10-28  WS-04.3b (docs)  `docs/v2-design.md` is now updated for the deadline removal (sections 3, 6, 9, 10, 12); section 4a now states the 189 passing / 11761 bytes numbers; pending decision recorded (admin cancel function, undecided) and a follow-up item added in the backlog (CON-04.7) listing docs that still mention the 120-day refund  - verified by: caller report only; tracker did not re-read `docs/v2-design.md` and did not re-run tests in this pass (189 / 11761 figures from the earlier tracker run)

2026-10-28  WS-04.3b (follow-up)  Removed the 120-day inactivity deadline from `MilestoneEscrow` (`milestoneDeadline`, `MAX_INACTIVITY_PERIOD`); `refundDeadProject` now requires `projectCancelled`; tests updated; CON-02.21 resolved as not applicable; freeze needs no clock pause; guardian shutdown of completed project accepted; 189 tests passing; MilestoneEscrow 11761 bytes; ABI getters removed  - verified by: tracker ran `npm test` (189 passing, 0 failing; compile reported nothing to recompile), measured MilestoneEscrow deployed bytecode 11761 bytes from the artifact, grep of `contracts/` and `test/` finds no `milestoneDeadline`/`MAX_INACTIVITY` (only two test titles mentioning "120 days of inactivity"); did not read the full diff. Note: `docs/v2-design.md` could not be updated by the tracker (scope hook), pending edit by caller

2026-10-28  WS-04.3b  Added `ForgeCapitaRegistry`; factory, escrow, distributor, router and P2P read roles from it; F1/F2 fixed in v2; 187 tests passing; CON-02.1 to CON-02.4, CON-02.18, CON-02.19 ticked; added CON-02.21 and CON-04.0  - verified by: tracker ran `npx hardhat compile` and `npm test` (187 passing, 0 failing), re-measured artifact sizes, read the registry and `git diff -- contracts`; Ignition and `scripts/` absent from `git status`

2026-10-28  WS-04.3a  Added baseline regression suite (146 tests) and failing F1/F2 tests; `npm test` wired to `hardhat test`; stale RevenueRouter test rewritten; CON-03.8 ticked; CON-03.9 deferred to WS-04.7  - verified by: `npm test` run by tracker (144 passing, 2 failing = F1, F2), `git status` shows no change under `contracts/`, test files opened (known-issues-v1.ts)
