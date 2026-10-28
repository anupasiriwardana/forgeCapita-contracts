# Gas measurements for the v2 sponsored actions (CON-03.9)

Date: 2026-10-28. Source: `test/GasMeasurement.ts` (run `npx hardhat test mocha test/GasMeasurement.ts`; it prints the table below). Contracts are the v2 sources in `contracts/` with the Hardhat config optimiser (200 runs, viaIR).

**What is measured and what is estimated**

- **Measured:** gas *units*, taken from `receipt.gasUsed` on the in-process Hardhat network. They include the 21,000 intrinsic cost and calldata, so they equal what a relayer is charged in gas.
- **Not measured, estimated:** every gas *price* (1 and 3 gwei on BSC Testnet, 0.1 gwei on Arbitrum Sepolia) and the Arbitrum L1 data fee (0.00006 ETH per transaction, carried over from design section 13). The tables below are arithmetic on measured units and these assumed prices. Nothing here was read from a live chain.
- Units can differ a little on a live chain (cold/warm access is the same, but the L1 data component on Arbitrum is not part of `gasUsed`). Re-run the test after any contract change.

## 1. Measured gas units

Fixture: a 2-milestone project (40/60), three backers (320/240/240 public tokens), one allow-listed relayer. "Steady" means not the first action of its kind in the project: the first sponsored action of a project writes `gasSpent` from zero, and the first claim/stake/vote touch fresh slots, which costs more once per project.

| Action | As allow-listed relayer (ledger on) | As plain caller (no ledger) | Notes |
|---|---|---|---|
| `claimTokensFor` | 124,396 steady (161,396 first sponsored action of the project) | 126,420 (first claim of the project) | Self-pay `claimTokens()`: 97,688 (a later claimer). Ledger overhead is about 26.7k. |
| `stakeWithPermit` | 154,920 steady (189,084 first staker) | 125,855 | Direct `stake` after approve: 78,950 (permit adds about 47k). Ledger overhead about 29k (incl. the external `recordSponsoredGas` call). |
| `voteBySig` | 112,630 steady (129,730 first voter) | 94,742 | Direct `vote`: 77,716 (94,816 for the first voter). Ledger overhead about 18k. |
| `executeMilestone`, non-final, no deduction | 111,586 | 99,715 | |
| `executeMilestone`, final, no deduction | 152,617 | 140,746 | Includes the 20% developer-token vesting transfer. |
| `executeMilestone`, non-final, with deduction | 145,599 | 133,713 | Extra treasury transfer, `GasDebtRecovered` event, more storage writes: about +34k. |
| `executeMilestone`, final, with deduction | 169,531 | 157,645 | |

The difference that matters between relayer and plain caller is the ledger: about 12k (execute) to 29k (stake). The sponsored-action cost the relayer pays is the relayer column.

## 2. Recomputed design section 13 formula

```
sponsoredGas = N * (G_claim + G_stake + M * G_vote) + M * G_execute
```

Inputs (relayer, steady state, conservative choices): N = 100, M = 5, G_claim = 124,396, G_stake = 154,920, G_vote = 112,630, G_execute = 4 non-final executes with deduction at 145,599 plus 1 final with deduction at 169,531 (751,927 in total). 705 transactions per project.

```
per investor  = 124,396 + 154,920 + 5 * 112,630 = 842,466
sponsoredGas  = 100 * 842,466 + 751,927 = 84,998,527   (about 85.0M gas)
cost          = sponsoredGas * gasPrice + 705 * l1Surcharge
minGoal       = cost * (1 + 50%) / 0.05
```

Section 13 used illustrative units totalling 73.75M gas; the measured total is about 85.0M, about 15% higher (claim 124k vs 80k assumed and vote 113k vs 100k assumed; stake 155k vs 150k; execute 146k to 170k vs 150k).

## 3. Minimum funding goal per chain (prices and L1 fee are estimates)

| Chain | Assumed price | Cost per project | With 50% margin | Minimum goal (cost x 1.5 / 0.05) | Section 13 value |
|---|---|---|---|---|---|
| BSC Testnet | 1 gwei, no L1 fee | 0.0850 BNB | 0.1275 BNB | about 2.55 BNB | about 2.2 BNB |
| BSC Testnet | 3 gwei, no L1 fee | 0.2550 BNB | 0.3825 BNB | about 7.65 BNB | about 6.6 BNB |
| Arbitrum Sepolia | 0.1 gwei L2 price (0.0085 ETH) + 705 x 0.00006 ETH L1 fee (0.0423 ETH) | 0.0508 ETH | 0.0762 ETH | about 1.52 ETH | about 1.6 ETH |

**L1 surcharge implication (Arbitrum).** `tx.gasprice` on Arbitrum is the L2 price, so the ledger does not see the L1 data fee. At the assumed numbers the L1 data fee is 0.0423 ETH of the 0.0508 ETH project cost, about 83%: without a non-zero `l1Surcharge` the ledger would book only about 0.0085 ETH of the real cost, the 5% budget would look about six times larger than it is, and the minimum goal derived from the ledger alone would be about 0.26 ETH instead of 1.52 ETH. On Arbitrum `l1Surcharge` is therefore the dominant term and must be set; it is also the term most exposed to estimate error.

## 4. Ledger accuracy: booked cost versus actual gas (finding)

Original finding: the first version booked `gasAtEntry - gasleft() + 21000 + 16 * msg.data.length` read before the remaining work of the call, which under-booked (claim 81%, stake 97%, vote 81%, execute 41% non-final and 30% final). CON-02.23 changed the contract: the reading moved to the end of the call and a named per-action overhead constant (`SponsoredGasCost`) covers the unmeasurable work; `executeMilestone` adds fixed constants for its payout tail (see design section 5). Units booked (recovered from `SponsoredGas` with a zero surcharge) versus `receipt.gasUsed` after the change:

| Action | Booked units | Actual units | Booked / actual (before change) | Booked / actual (now) |
|---|---|---|---|---|
| claim (steady) | 119,735 | 124,427 | 81% | 96.2% |
| claim (first in project) | 119,735 | 161,427 | n/a | 74.2% |
| stake (steady) | 153,417 | 154,951 | 97% | 99.0% |
| stake (first staker) | 187,617 | 189,139 | n/a | 99.2% |
| vote (steady) | 110,084 | 112,661 | 81% | 97.7% |
| vote (first voter) | 127,184 | 129,749 | n/a | 98.0% |
| execute, non-final, no deduction | 108,185 | 111,707 | 41% | 96.8% |
| execute, final, no deduction | 148,173 | 152,726 | 30% | 97.0% |

The ledger never over-books in the measured cases (asserted in `test/GasMeasurement.ts`, together with a 95% floor for steady calls and 70% for first-in-project calls). The remaining gap is the unmeasurable work kept deliberately below its minimum so booked stays at or under actual, plus one-off first-write costs. Calls whose real cost is below the calibrated case (for example a claim to an account that already holds tokens, or an execute with no payout) can be booked slightly above actual. Because the booked amounts moved closer to actual, the earlier "shortfall per action" numbers in section 5 shrink to roughly 3k to 5k gas per action (about 5k for first-in-project claims excluded) and the minimum-goal computation in section 3 is conservatively unchanged.

## 5. Suggested starting values (suggestions only; the guardian sets them, nothing is deployed)

Gas-equivalent shortfall per action from section 4 (actual minus booked): claim about 24k, stake about 4k, vote about 21.5k, execute about 66k (non-final) to 107k (final), roughly 80k average.

| Parameter | BSC Testnet (1 gwei) | Arbitrum Sepolia (0.1 gwei) |
|---|---|---|
| `l1Surcharge(Claim)` | 0.000024 BNB (2.4e13 wei) | 0.00006 ETH L1 fee + 0.0000024 ETH = about 6.3e13 wei |
| `l1Surcharge(Stake)` | 0.000004 BNB (4e12 wei) | about 6.0e13 wei |
| `l1Surcharge(Vote)` | 0.000022 BNB (2.2e13 wei) | about 6.2e13 wei |
| `l1Surcharge(Execute)` | 0.00008 BNB (8e13 wei) | about 6.8e13 wei |
| `maxCostPerAction` | 0.001 BNB (1e15 wei) | 0.0002 ETH (2e14 wei) |

How to read them: BSC has no L1 fee, so its surcharges only compensate for the booking shortfall in section 4 and scale with the gas price (they are flat, so re-set them if the price moves much). The BSC cap of 0.001 BNB is about 1.7x the largest single legitimate cost at 3 gwei (about 170k gas x 3 gwei = 0.00051 BNB plus the 0.00008 BNB execute surcharge); a price spike beyond that is booked at the cap, which limits what the ledger can be pushed to but also hides the extra real cost. Arbitrum values are the assumed L1 fee plus the shortfall priced at 0.1 gwei and a cap of about 2.3x the largest expected cost. Both contract limits (`MAX_COST_PER_ACTION_LIMIT`, `MAX_L1_SURCHARGE_LIMIT` = 1 ETH) are far above these. Recalibrate with a real L1 fee sample and the API gas oracle's 24-hour average before setting them on a live chain.
