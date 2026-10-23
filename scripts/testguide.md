# forgeCapita Test Guide

This directory contains 11 automated simulation scripts designed to test the entire lifecycle, edge cases, and security fallbacks of the updated forgeCapita smart contract ecosystem (Proxy-based Architecture).

These tests execute against a local Hardhat blockchain. They deploy fresh master implementations and factory proxies in memory, simulate EVM time travel for deadline/quorum testing, verify the Staked-Governance vote locks, check the 24/1/75 SaaS revenue routing, and **calculate and log the exact gas fee expenditures** to simulate the ERC-4337 dynamic routing model.

## 🟢 Positive Lifecycle Scenarios

### Scenario 1: Proxy Crowdfunding, 5% Fee & 80/20 Split
- **File:** `scenario1.ts`
- **Description:** Tests the proxy factory deployment and initial capital formation. 5 Investors fund a 10 ETH goal. Verifies that the Treasury pulls a 5% fee (0.5 ETH), investors claim their pro-rata shares of the 80% public token pool, and logs the gas costs for the developer (who pays the deployment gas) vs the investors (who have their funding gas subsidized by the treasury). 
```bash
docker-compose exec hardhat npx hardhat run ./scripts/scenario1.ts --network localhost

```

### Scenario 2: Staked Governance, Fast-Track Execution & Gas Tracking

* **File:** `scenario2.ts`
* **Description:** Tests the active governance requirement. Investors stake their equity to activate voting power. A majority holder (>50%) votes YES, triggering instant execution. Logs the explicit gas costs to prove that developers pay for milestone execution while investor voting is optimized.

```bash
docker-compose exec hardhat npx hardhat run ./scripts/scenario2.ts --network localhost

```

### Scenario 3: Complete Roadmap & Cliff Vesting

* **File:** `scenario3.ts`
* **Description:** Proves a developer can successfully traverse a multi-stage roadmap without deadlocking. Upon executing the final milestone, the Escrow ETH pool is fully drained to the developer, and the 20% developer token equity cliff-vests to their wallet.

```bash
docker-compose exec hardhat npx hardhat run ./scripts/scenario3.ts --network localhost

```

### Scenario 4: 120-Day Deadlock & Pro-Rata Refunds

* **File:** `scenario4.ts`
* **Description:** Tests project abandonment. 120 days pass without a milestone execution. Investors unstake their tokens and surrender them via `refundDeadProject()` to claim their exact mathematical share of the remaining locked ETH. Logs the gas cost of refund claiming.

```bash
docker-compose exec hardhat npx hardhat run ./scripts/scenario4.ts --network localhost

```

## 🟡 Revenue & Utility Scenarios

### Scenario 5: SaaS Revenue Routing & Gas Limits

* **File:** `scenario5.ts`
* **Description:** A customer pays for a SaaS subscription. Verifies the `RevenueRouter` perfectly splits the payment (24/1/75). Also tracks the gas cost for an investor to claim their yield (which is dynamically subsidized depending on network congestion).

```bash
docker-compose exec hardhat npx hardhat run ./scripts/scenario5.ts --network localhost

```

### Scenario 6: Zero-Staker Revenue Fallback

* **File:** `scenario6.ts`
* **Description:** Tests the `RevenueRouter` edge case where a SaaS payment arrives, but no investors are currently staked. Verifies the transaction does not revert, and the unallocated 75% yield safely defaults to the developer's operating runway.

```bash
docker-compose exec hardhat npx hardhat run ./scripts/scenario6.ts --network localhost

```

### Scenario 7: Secondary Market (Investor-Paid Gas)

* **File:** `scenario7.ts`
* **Description:** Tests the non-custodial OTC order desk. An investor lists tokens for a fixed ETH price, and a buyer fills the order. Logs the exact gas fees paid to prove that the ForgeCapita Treasury provides **zero gas subsidies** for secondary market trading.

```bash
docker-compose exec hardhat npx hardhat run ./scripts/scenario7.ts --network localhost

```

## 🔴 Governance & Edge Case Scenarios

### Scenario 8: 28-Day Quorum Fallback Execution

* **File:** `scenario8.ts`
* **Description:** Tests voter apathy mitigation. A milestone receives only 30% YES votes (failing the >50% Fast-Track). The EVM fast-forwards 28 days. Because 30% meets the minimum 20% quorum, the milestone executes successfully.

```bash
docker-compose exec hardhat npx hardhat run ./scripts/scenario8.ts --network localhost

```

### Scenario 9: Soft-Cap Failure (Missed Funding Deadline)

* **File:** `scenario9.ts`
* **Description:** Tests an underfunded campaign. The 30-day funding timer expires before the goal is reached. Investors call `refundFailedCrowdfund()` to retrieve 100% of their raw ETH deposits.

```bash
docker-compose exec hardhat npx hardhat run ./scripts/scenario9.ts --network localhost

```

### Scenario 10: Sybil Vote-Lock Exploit Protection

* **File:** `scenario10.ts`
* **Description:** Proves that an investor cannot double-vote. Once an investor casts a vote on an active milestone, the `DividendDistributor` actively blocks them from withdrawing their tokens, physically preventing Sybil transfers until the poll closes.

```bash
docker-compose exec hardhat npx hardhat run ./scripts/scenario10.ts --network localhost

```

### Scenario 11: Developer Role Migration

* **File:** `scenario11.ts`
* **Description:** Tests the two-step developer transfer protocol. The active developer proposes a new wallet address. The new address accepts. Verifies that milestone payouts and permissions securely migrate to the new address.

```bash
docker-compose exec hardhat npx hardhat run ./scripts/scenario11.ts --network localhost

```