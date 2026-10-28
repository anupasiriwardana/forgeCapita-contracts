# Gas measurements for the v2 sponsored actions (CON-03.9, recalibrated by CON-03.12)

Date: 2026-10-28 (re-measured for CON-03.12 after the end-of-call booking of CON-02.23). Source: `test/GasMeasurement.ts` (run `npx hardhat test mocha test/GasMeasurement.ts`; it prints the table below). Contracts are the v2 sources in `contracts/` with the Hardhat config optimiser (200 runs, viaIR). Full suite at measurement time: 316 passing, MilestoneEscrow runtime 16,040 bytes.

**What is measured and what is estimated**

- **Measured:** gas *units*, taken from `receipt.gasUsed` on the in-process Hardhat network, and the units the ledger booked (the test recovers them from the `SponsoredGas` event with a zero surcharge). They include the 21,000 intrinsic cost and calldata, so they equal what a relayer is charged in gas. The booked units of the "with deduction" execute rows are **derived, not measured**: `executeMilestone` books before the deduction and payout code runs, with fixed constants, so they equal the no-deduction booked units (108,185 non-final, 148,173 final).
- **Not measured, estimated:** every gas *price* (1 and 3 gwei on BSC Testnet, 0.1 gwei on Arbitrum Sepolia) and the Arbitrum L1 data fee (0.00006 ETH per transaction, carried over from design section 13). Everything priced in BNB/ETH below is arithmetic on measured units and these assumed prices. Nothing here was read from a live chain.
- Units can differ a little on a live chain (cold/warm access is the same, but the L1 data component on Arbitrum is not part of `gasUsed`). Re-run the test after any contract change.

## 1. Measured gas units

Fixture: a 2-milestone project (40/60), three backers (320/240/240 public tokens), one allow-listed relayer. "Steady" means not the first action of its kind in the project: the first sponsored action of a project writes `gasSpent` from zero, and the first claim/stake/vote touch fresh slots, which costs more once per project.

| Action | As allow-listed relayer (ledger on) | As plain caller (no ledger) | Notes |
|---|---|---|---|
| `claimTokensFor` | 124,427 steady (161,427 first sponsored action of the project) | 126,420 (first claim of the project) | Self-pay `claimTokens()`: 97,688 (a later claimer). Ledger overhead is about 26.7k. |
| `stakeWithPermit` | 154,951 steady (189,139 first staker) | 125,843 | Direct `stake` after approve: 78,950 (permit adds about 47k). Ledger overhead about 29k (incl. the external `recordSponsoredGas` call). |
| `voteBySig` | 112,661 steady (129,761 first voter) | 94,754 | Direct `vote`: 77,716 (94,816 for the first voter). Ledger overhead about 18k. |
| `executeMilestone`, non-final, no deduction | 111,707 | 99,780 | |
| `executeMilestone`, final, no deduction | 152,726 | 140,799 | Includes the 20% developer-token vesting transfer. |
| `executeMilestone`, non-final, with deduction | 145,720 | 133,778 | Extra treasury transfer, `GasDebtRecovered` event, more storage writes: about +34k. |
| `executeMilestone`, final, with deduction | 169,640 | 157,698 | |

The difference that matters between relayer and plain caller is the ledger: about 12k (execute) to 29k (stake). The sponsored-action cost the relayer pays is the relayer column.

## 2. Recomputed design section 13 formula

```
sponsoredGas = N * (G_claim + G_stake + M * G_vote) + M * G_execute
```

Inputs (relayer, steady state, conservative choices): N = 100, M = 5, G_claim = 124,427, G_stake = 154,951, G_vote = 112,661, G_execute = 4 non-final executes with deduction at 145,720 plus 1 final with deduction at 169,640 (752,520 in total). 705 transactions per project.

```
per investor  = 124,427 + 154,951 + 5 * 112,661 = 842,683
sponsoredGas  = 100 * 842,683 + 752,520 = 85,020,820   (about 85.0M gas; previous 84,998,527, +0.03%)
cost          = sponsoredGas * gasPrice + 705 * l1Surcharge
minGoal       = cost * (1 + 50%) / 0.05
```

The formula uses actual gas (what the relayer really pays), not booked gas, so the booking change of CON-02.23 does not alter it. The one-off first-in-project extras (claim +37,000, stake +34,188, vote +17,100, about 88k gas in total) are 0.1% and are left out; the 50% margin covers them. Using the "with deduction" execute cost is conservative: deduction only happens once the project exceeded its budget.

Section 13 used illustrative units totalling 73.75M gas; the measured total is about 85.0M, about 15% higher (claim 124k vs 80k assumed and vote 113k vs 100k assumed; stake 155k vs 150k; execute 146k to 170k vs 150k).

## 3. Minimum funding goal per chain (prices and L1 fee are estimates)

| Chain | Assumed price | Cost per project (real spend) | With 50% margin | Minimum goal (cost x 1.5 / 0.05) | Section 13 value |
|---|---|---|---|---|---|
| BSC Testnet | 1 gwei, no L1 fee | 85,020,820 x 1e9 = 0.08502 BNB | 0.12753 BNB | about 2.55 BNB (2.5506) | about 2.2 BNB |
| BSC Testnet | 3 gwei, no L1 fee | 85,020,820 x 3e9 = 0.25506 BNB | 0.38259 BNB | about 7.65 BNB (7.6519) | about 6.6 BNB |
| Arbitrum Sepolia | 0.1 gwei L2 price (0.0085021 ETH) + 705 x 0.00006 ETH L1 fee (0.0423 ETH) | 0.05080 ETH | 0.07620 ETH | about 1.52 ETH (1.5241) | about 1.6 ETH |

Result of the CON-03.12 recheck: the goals are unchanged at the displayed precision (2.55 BNB, 7.65 BNB, 1.52 ETH). The previously quoted figures stay valid.

**L1 surcharge implication (Arbitrum).** `tx.gasprice` on Arbitrum is the L2 price, so the ledger does not see the L1 data fee. At the assumed numbers the L1 data fee is 0.0423 ETH of the 0.0508 ETH project cost, about 83%. Without a non-zero `l1Surcharge` the ledger would book only the L2 part of its booked gas, 82,938,113 x 0.1 gwei = 0.00829 ETH (16% of the real cost, about 6.1 times too small); the 5% budget would look about six times larger than it is and a minimum goal derived from the ledger alone would be about 0.25 ETH (0.00829 x 1.5 / 0.05 = 0.249; earlier text said 0.26) instead of 1.52 ETH. On Arbitrum `l1Surcharge` is therefore the dominant term and must be set; it is also the term most exposed to estimate error.

## 4. Ledger accuracy: booked cost versus actual gas (finding)

Original finding: the first version booked `gasAtEntry - gasleft() + 21000 + 16 * msg.data.length` read before the remaining work of the call, which under-booked (claim 81%, stake 97%, vote 81%, execute 41% non-final and 30% final). CON-02.23 changed the contract: the reading moved to the end of the call and a named per-action overhead constant (`SponsoredGasCost`) covers the unmeasurable work; `executeMilestone` adds fixed constants for its payout tail (see design section 5). Units booked (recovered from `SponsoredGas` with a zero surcharge) versus `receipt.gasUsed` after the change (measured 2026-10-28):

| Action | Booked units | Actual units | Gap (actual - booked) | Booked / actual (before change) | Booked / actual (now) |
|---|---|---|---|---|---|
| claim (steady) | 119,735 | 124,427 | 4,692 | 81% | 96.2% |
| claim (first in project) | 119,735 | 161,427 | 41,692 | n/a | 74.2% (on purpose, one-off) |
| stake (steady) | 153,417 | 154,951 | 1,534 | 97% | 99.0% |
| stake (first staker) | 187,617 | 189,139 | 1,522 | n/a | 99.2% |
| vote (steady) | 110,084 | 112,661 | 2,577 | 81% | 97.7% |
| vote (first voter) | 127,184 | 129,761 | 2,577 | n/a | 98.0% |
| execute, non-final, no deduction | 108,185 | 111,707 | 3,522 | 41% | 96.8% |
| execute, final, no deduction | 148,173 | 152,726 | 4,553 | 30% | 97.0% |
| execute, non-final, with deduction (booked derived) | 108,185 | 145,720 | 37,535 | n/a | 74.2% |
| execute, final, with deduction (booked derived) | 148,173 | 169,640 | 21,467 | n/a | 87.3% |

The ledger never over-books in the measured cases (asserted in `test/GasMeasurement.ts`, together with a 95% floor for steady calls and 70% for first-in-project calls). The remaining gap is the unmeasurable work kept deliberately below its minimum so booked stays at or under actual, plus one-off first-write costs. Calls whose real cost is below the calibrated case (for example a claim to an account that already holds tokens, or an execute with no payout) can be booked slightly above actual.

Correction to the earlier text: the real remaining gap in steady state is about 1.5k to 4.7k gas per action (claim 4.7k, stake 1.5k, vote 2.6k, execute 3.5k to 4.6k), and the first claim in a project is booked at 74% on purpose (a one-off of about 41.7k). The one case that remains clearly under-booked is **execute with a deduction** (gap 37.5k non-final, 21.5k final): the booking happens before the deduction transfer, its event and the extra storage writes, which the fixed execute constants do not cover. That case occurs only when the project has already exceeded its 5% budget, i.e. in the exceptional situation, and the missing amount is at most five executions (about 0.19M gas, 0.2% of the project's 85.0M gas).

On the earlier closing sentence of this section ("the minimum-goal computation in section 3 is conservatively unchanged"): verified, but not because it is conservative. The minimum goal is computed from the gas the relayer actually pays (`receipt.gasUsed`), which the booking change does not touch; it moved only by +0.03% because the re-measured units shifted by a few dozen gas. What the booking changes is how closely the ledger tracks that spend (section 6).

## 5. Suggested starting values (suggestions only; the guardian sets them, nothing is deployed)

Rule: each `l1Surcharge(action)` = (L1 fee on Arbitrum, 0 on BSC) + the steady-state gas gap from section 4 priced at the chain's gas price, rounded down so the ledger stays at or below real cost. `maxCostPerAction` = largest legitimate single booked cost (first staker, booked 187,617 gas, plus its surcharge), times a headroom factor. Execute uses one value for non-final and final (gaps 3,522 and 4,553 gas; value from about 3.5k). The deduction-path execute gap (21k to 38k) is deliberately not priced into the flat surcharge, because that would over-book every ordinary execute. Every value below changes versus the previous suggestion unless marked "unchanged".

### BSC Testnet (no L1 fee; the surcharge only closes the 1.5k to 4.7k gas gap and may be 0)

| Parameter | 1 gwei | 3 gwei | Previous suggestion (1 gwei) |
|---|---|---|---|
| `l1Surcharge(Claim)` | 4.5e12 wei (0.0000045 BNB; gap 4,692 gas) | 1.35e13 wei | 2.4e13 (changed) |
| `l1Surcharge(Stake)` | 1.5e12 wei (gap 1,534 gas) | 4.5e12 wei | 4e12 (changed) |
| `l1Surcharge(Vote)` | 2.5e12 wei (gap 2,577 gas) | 7.5e12 wei | 2.2e13 (changed) |
| `l1Surcharge(Execute)` | 3.5e12 wei (gap 3,522 to 4,553 gas) | 1.05e13 wei | 8e13 (changed) |
| `maxCostPerAction` | 3.5e14 wei (0.00035 BNB) | 1e15 wei (0.001 BNB) | 1e15 (changed for 1 gwei, unchanged for 3 gwei) |

Cap derivation: largest legitimate cost at 1 gwei = 187,617 x 1e9 + 1.5e12 = 1.89e14 wei, times 1.85 = 3.5e14. At 3 gwei = 187,617 x 3e9 + 4.5e12 = 5.67e14 wei, times 1.76 = 1e15 (the previous value). A price above about 1.85x (1 gwei option) or 1.76x (3 gwei option) the assumed one is booked at the cap, which limits what the ledger can be pushed to but also hides the extra real cost. Surcharges are flat in wei, so re-set them if the price moves much; setting all four to 0 is acceptable on BSC (it books about 97.5% of the real cost instead of 99.75%).

### Arbitrum Sepolia (0.1 gwei L2 price, L1 fee 0.00006 ETH per transaction, still an estimate)

| Parameter | Proposed value | Arithmetic | Previous suggestion |
|---|---|---|---|
| `l1Surcharge(Claim)` | 6.04e13 wei | 6e13 + 4,692 x 1e8 = 6.047e13 | 6.3e13 (changed) |
| `l1Surcharge(Stake)` | 6.01e13 wei | 6e13 + 1,534 x 1e8 = 6.015e13 | 6.0e13 (changed, marginally) |
| `l1Surcharge(Vote)` | 6.02e13 wei | 6e13 + 2,577 x 1e8 = 6.026e13 | 6.2e13 (changed) |
| `l1Surcharge(Execute)` | 6.03e13 wei | 6e13 + 3,522 x 1e8 = 6.035e13 | 6.8e13 (changed) |
| `maxCostPerAction` | 2e14 wei (0.0002 ETH) | largest = 187,617 x 1e8 + 6.01e13 = 7.89e13; times 2.5 | 2e14 (unchanged) |

The 2.5x headroom on Arbitrum (against 1.8x on BSC) is deliberate: the L1 fee is the volatile, estimated term, and a cap that clips an L1 spike would hide real cost. The surcharges are about 99% L1 fee, so they should be re-derived from a real L1 fee sample and the API gas oracle's 24-hour average before setting them on a live chain. All values are far below both contract limits (`MAX_COST_PER_ACTION_LIMIT`, `MAX_L1_SURCHARGE_LIMIT` = 1 ETH).

## 6. Booked versus actual over a whole project, and the budget, ceiling and 15% cap

Booked gas for the design project (N = 100, M = 5, steady state; execute booked at the no-deduction constants):

```
per investor = 119,735 + 153,417 + 5 * 110,084 = 823,572
booked gas   = 100 * 823,572 + (4 * 108,185 + 148,173) = 82,357,200 + 580,913 = 82,938,113
actual gas   = 85,020,820          booked / actual = 97.55%   (gap 2,082,707 gas, 2.45%)
```

Priced with the proposed surcharges (sum of surcharges: BSC 1 gwei = 100 x (4.5e12 + 1.5e12 + 5 x 2.5e12) + 5 x 3.5e12 = 1.8675e15 wei):

| Chain | Actual spend | Booked, no surcharge | Booked with proposed surcharges | Booked / actual |
|---|---|---|---|---|
| BSC 1 gwei | 0.085021 BNB | 0.082938 (97.55%) | 0.082938 + 0.001868 = 0.084806 BNB | 99.75% |
| BSC 3 gwei | 0.255062 BNB | 0.248814 (97.55%) | 0.248814 + 0.005603 = 0.254417 BNB | 99.75% |
| Arbitrum Sepolia | 0.050802 ETH | 0.008294 (16.3%) | 0.008294 + 0.042452 = 0.050745 ETH | 99.89% |

**Does the ledger bind earlier than real spend suggests?** At the proposed minimum goal G the budget (5%) is exactly 1.5 times the real spend R0 of the design project (the 50% margin), so the booked spend uses 99.75% / 1.5 = 66.5% of the budget (BSC) and 66.6% (Arbitrum). The ceiling is `budget + 15% x netFunds = 0.05 G + 0.15 x 0.95 G = 0.1925 G = 5.775 R0`; booked spend is 17.3% of it. Example, BSC 1 gwei: G = 2.55 BNB, budget 0.1275, netFunds 2.4225, ceiling 0.1275 + 0.3634 = 0.4909 BNB, booked 0.0848 BNB. So under the design assumptions the ledger never reaches the budget, never deducts, and cannot revert a sponsored call; the booking gap (2.45% without surcharge) is irrelevant. Booking error only matters once the real spend passes the budget: the budget is exceeded at about 1.5 / 0.9975 = 1.50 times the design spend (more investors, more votes, higher gas price or L1 fee than assumed), and sponsored calls revert at about 5.79 times. Booking is therefore not the binding assumption; the usage and price assumptions are.

**Does the 15% cap leave real spend unrecovered?** Only the part of the spend above the budget is ever recovered (and only booked spend). Total deductions are at most 15% of netFunds by construction, which equals the ceiling minus the budget, so the ceiling already prevents booking more than can be recovered. The remaining unrecovered amounts are: (a) real minus booked spend, 2.45% of the project (0.25% with the proposed surcharges), plus up to about 0.2% extra from deduction-path executes; this is absorbed by the budget while real spend is below budget (66.7% used at the design point); (b) debt still outstanding at the final milestone, which is written off. The claim "everything above the budget is recovered" therefore relies on these assumptions: 1. all overflow is booked before the final `executeMilestone` (claims or stakes after project completion cannot be recovered); 2. the milestone releases leave room for the per-milestone 15% cap in time, i.e. overflow booked before milestone k is no more than the cumulative 15% of releases 1..k plus what the later releases can still take (with five equal 20% releases the cap is 2.85% of G per milestone, 14.25% of G in total, so overflow must not arrive faster than that); 3. the real spend does not exceed the ceiling by more than the booking gap, which the revert at the ceiling enforces on booked units only. At the proposed goals none of these is exercised in the design scenario, because no overflow occurs.

## 7. Proposed numbers for the CON-03.10 decision (the user decides)

| Chain | Option | `maxCostPerAction` | `l1Surcharge` Claim / Stake / Vote / Execute (wei) | Minimum goal |
|---|---|---|---|---|
| BSC Testnet | 1 gwei | 3.5e14 | 4.5e12 / 1.5e12 / 2.5e12 / 3.5e12 (or all 0) | 2.55 BNB |
| BSC Testnet | 3 gwei | 1e15 | 1.35e13 / 4.5e12 / 7.5e12 / 1.05e13 (or all 0) | 7.65 BNB |
| Arbitrum Sepolia | 0.1 gwei + 0.00006 ETH L1 fee | 2e14 | 6.04e13 / 6.01e13 / 6.02e13 / 6.03e13 | 1.52 ETH |
