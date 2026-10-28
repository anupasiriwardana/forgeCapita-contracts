# ForgeCapita Contracts — Service Status & Technical Health Report

**Service:** `forgecapita-contracts` (Solidity / Hardhat 3, OpenZeppelin clones)
**Networks:** Arbitrum Sepolia (`421614`) and BSC Testnet (`97`)
**Last Updated:** 2026-10-28
**Location of this file:** moved here from the workspace root on 2026-10-28.

---

## 1. Executive Summary

**v1 is deployed to both testnets and frozen.** v2 (gasless relayer) is **planned, not started**. The v2 plan is in `backlog-contracts.md`. The freeze was lifted on 2026-10-28 (CON-00.1, CON-00.3 done, verified by hook probes): contracts may be edited, compiled and tested; deployment stays a user action. v1 addresses are recorded in `docs/deployments-v1.md` (CON-00.2, address half). The `v1-testnet` git tag exists. The v2 design draft `docs/v2-design.md` was written and **approved by the user on 2026-10-28** (changes: freeze limits of 45 days per freeze and 90 days cumulative; a per-chain minimum funding goal, section 13). It also lists two apparent v1 bugs (F1: `refundDeadProject` appears callable right after funding closes because `milestoneDeadline` starts at 0; F2: it becomes callable on a completed project) that still need failing tests to confirm.

The user accepted redeploying and re-syncing the indexer, so v2 is a fresh deployment (new factory, implementations, P2P exchange). v1 testnet projects are not migrated.

---

## 2. v1 Contracts (deployed, frozen)

`ForgeCapitaFactory` (EIP-1167 clones), `ProjectToken`, `MilestoneEscrow`, `DividendDistributor`, `RevenueRouter` per project, plus one `P2PExchange`.

- 5% platform fee at funding close; revenue split 24% developer / 1% treasury / 75% stakers; 1% P2P fee.
- Voting weight = staked balance in `DividendDistributor`; voters are locked until the poll closes. 28-day vote, 20% quorum, >50% fast track, 120-day inactivity deadlock.
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

Everything in `backlog-contracts.md` is pending. Design is approved. Next: CON-03.8 (baseline tests and failing F1/F2 tests against the v1 code), then CON-02.18 (registry) and the rest of Phase 2.

## 5. Summary Checklist of Next Steps

1. [x] CON-00.1 freeze lifted; CON-00.3 tracking scope updated.
   [x] CON-00.2 `v1-testnet` tag created; v1 addresses recorded.
2. [x] CON-01 design document written and approved (decisions CON-01.2 to CON-01.7 resolved).
3. [ ] CON-02 implementation, CON-03 tests.
4. [ ] `[USER-ACTION]` CON-04 deploy to both testnets, fund and allow-list the relayer.
