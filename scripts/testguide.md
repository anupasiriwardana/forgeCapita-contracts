# forgeCapita Test Guide

This directory contains 10 automated simulation scripts designed to test the
entire lifecycle, edge cases, and security fallbacks of the forgeCapita smart
contract ecosystem.

These tests execute against a local Hardhat blockchain. They deploy fresh
factory instances in memory, simulate time travel for deadline testing, and
execute complex mathematical accounting to verify that capital is routed
correctly.

## Prerequisites

Ensure that Docker is running and the contracts are compiled before executing
the tests:

```bash
docker-compose up -d
docker-compose exec hardhat npx hardhat compile
```

## 🟢 Positive Lifecycle Scenarios

### Scenario 1: Funding & Treasury Success Fee

- **File:** `scenario1.ts`
- **Description:** Tests the initial crowdfunding phase. Two investors fund a
  10 ETH project. The developer closes the funding phase, triggering the
  automated 5% platform fee transfer to the ForgeCapita Treasury.
- **Execution:**

  ```bash
  docker-compose exec hardhat npx hardhat run ./scripts/scenario1.ts --network localhost
  ```

- **Expected result:** Investor 1 claims 400,000 tokens, Investor 2 claims
  600,000 tokens, and the Treasury successfully receives exactly 0.5 ETH (the
  5% success fee).

### Scenario 2: Milestone Execution & Revenue Router Split

- **File:** `scenario2.ts`
- **Description:** Tests the absolute majority voting mechanics and the SaaS
  revenue "Pull-over-Push" routing. Investors vote to release the first
  milestone. A customer then pays 1 ETH for the SaaS product.
- **Execution:**

  ```bash
  docker-compose exec hardhat npx hardhat run ./scripts/scenario2.ts --network localhost
  ```

- **Expected result:** The developer receives 4.75 ETH for the milestone. The
  1 ETH SaaS payment is split successfully: 0.6 ETH is pushed directly to the
  Dividend Pool, 0.39 ETH is held in the Developer's ledger, and 0.01 ETH is
  held in the Treasury ledger. The developer successfully pulls their 0.39 ETH.

### Scenario 3: Complete Roadmap Lifecycle

- **File:** `scenario3.ts`
- **Description:** Proves that a developer can traverse a multi-stage roadmap
  without the contract deadlocking. Simulates a 3-stage roadmap (40% / 30% /
  30%) by looping through `requestNextMilestone()`, `vote()`, and
  `executeMilestone()`.
- **Execution:**

  ```bash
  docker-compose exec hardhat npx hardhat run ./scripts/scenario3.ts --network localhost
  ```

- **Expected result:** All three milestones execute consecutively. The final
  Escrow balance is strictly 0.0 ETH, proving that 100% of the net funds were
  paid out without mathematical remainder dust.

### Scenario 4: High-Volume SaaS & Yield Accumulation

- **File:** `scenario4.ts`
- **Description:** Tests the scalable math of the DividendDistributor and
  RevenueRouter. Three different customers pay for the SaaS product, totaling
  4.5 ETH.
- **Execution:**

  ```bash
  docker-compose exec hardhat npx hardhat run ./scripts/scenario4.ts --network localhost
  ```

- **Expected result:** The Router ledgers accurately accumulate the cuts over
  multiple payments. Investor 1, holding 60% of the equity, successfully
  pulls exactly 60% of the accumulated 2.70 ETH dividend pool (1.62 ETH).

## 🔴 Negative Failure Scenarios

### Scenario 5: Mid-Project Deadlock (90-Day Timeout)

- **File:** `scenario5.ts`
- **Description:** Tests a mid-project abandonment. The project funds
  successfully, but 91 days pass without a milestone vote occurring.
- **Execution:**

  ```bash
  docker-compose exec hardhat npx hardhat run ./scripts/scenario5.ts --network localhost
  ```

- **Expected result:** Investors surrender their Project Tokens back to the
  Escrow contract via `refundDeadProject()` and recover their proportional
  share of the remaining locked ETH pool.

### Scenario 6: Soft-Cap Failure (Funding Deadline Missed)

- **File:** `scenario6.ts`
- **Description:** Tests an underfunded project. The developer aims for 10 ETH
  but raises only 7 ETH. The 30-day funding deadline expires.
- **Execution:**

  ```bash
  docker-compose exec hardhat npx hardhat run ./scripts/scenario6.ts --network localhost
  ```

- **Expected result:** Because the goal was missed, `closeFundingAndStart()`
  cannot be called. Investors call `refundFailedCrowdfund()` and retrieve
  their original ETH deposits without ever touching Project Tokens.

### Scenario 7: Mid-Project Deadlock on Second Milestone

- **File:** `scenario7.ts`
- **Description:** Proves that the Escrow protects remaining capital even if a
  developer successfully delivers early milestones but abandons later ones.
  Milestone 0 executes, but Milestone 1 times out after 90 days.
- **Execution:**

  ```bash
  docker-compose exec hardhat npx hardhat run ./scripts/scenario7.ts --network localhost
  ```

- **Expected result:** Investors surrender their Project Tokens and pull their
  proportional share of the remaining ETH pool (for example, from the 5.7 ETH
  left in the vault rather than the original 9.5 ETH).

### Scenario 8: Unauthorized Execution Attempt (Absolute Majority)

- **File:** `scenario8.ts`
- **Description:** Proves the Sybil-resistant voting safeguards. An investor
  with only 40% voting power votes "Yes." The developer attempts to forcibly
  unlock the funds.
- **Execution:**

  ```bash
  docker-compose exec hardhat npx hardhat run ./scripts/scenario8.ts --network localhost
  ```

- **Expected result:** The execution transaction is rejected and reverts with
  `"Not enough Yes votes"`, proving that strictly more than 50% of the entire
  token supply is required to unlock capital.

## 🛡️ Edge Case & Exploit Scenarios

### Scenario 9: "Double-Dip" Exploit Attempt

- **File:** `scenario9.ts`
- **Description:** Proves that malicious actors cannot drain the contract or rig
  votes by calling functions multiple times. Simulates an investor trying to
  claim tokens twice and vote twice.
- **Execution:**

  ```bash
  docker-compose exec hardhat npx hardhat run ./scripts/scenario9.ts --network localhost
  ```

- **Expected result:** Both exploit attempts fail immediately. The EVM reverts
  with `"Tokens already claimed"` and `"Already voted"`.

### Scenario 10: Retroactive Yield Theft Protection

- **File:** `scenario10.ts`
- **Description:** Tests the "High-Water Mark" scaled accumulator math. Investor
  1 stakes early and SaaS revenue arrives. Investor 2 stakes later, and more
  SaaS revenue arrives.
- **Execution:**

  ```bash
  docker-compose exec hardhat npx hardhat run ./scripts/scenario10.ts --network localhost
  ```

- **Expected result:** Investor 2 receives a share only of the revenue generated
  after they stake. The contract mathematically prevents Investor 2 from
  claiming revenue generated while only Investor 1 was staked.