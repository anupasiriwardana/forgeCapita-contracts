# forgeCapita-v2 Test Guide

This directory contains 11 automated simulation scripts designed to test the entire lifecycle, edge cases, and security fallbacks of the updated forgeCapita-v2 smart contract ecosystem.

These tests execute against a local Hardhat blockchain. They deploy fresh factory instances in memory, simulate EVM time travel for deadline/quorum testing, and verify the Staked-Governance vote locks and 24/1/75 SaaS revenue routing.

## 🟢 Positive Lifecycle Scenarios

### Scenario 1: Crowdfunding, 5% Fee & 80/20 Token Split
- **File:** `scenario1.ts`
- **Description:** Tests the initial capital formation. Investors fund a 10 ETH goal. Verifies that the platform Treasury pulls a 5% fee (0.5 ETH), investors claim their pro-rata shares of the 80% public token pool, and the developer's 20% equity is correctly locked in the Escrow for cliff vesting.
```bash
docker-compose exec hardhat npx hardhat run ./scripts/scenario1.ts --network localhost
```

### Scenario 2: Staked Governance & Fast-Track Execution
- **File:** `scenario2.ts`
- **Description:** Tests the active governance requirement. Investors stake their equity in the `DividendDistributor` to activate voting power. A majority holder (>50%) votes YES, triggering the instant "Fast-Track" milestone execution.
```bash
docker-compose exec hardhat npx hardhat run ./scripts/scenario2.ts --network localhost
```

### Scenario 3: Complete Roadmap & Cliff Vesting
- **File:** `scenario3.ts`
- **Description:** Proves a developer can successfully traverse a multi-stage roadmap without deadlocking. Upon executing the final milestone, the Escrow ETH pool is fully drained to the developer, and the 20% developer token equity cliff-vests to their wallet.
```bash
docker-compose exec hardhat npx hardhat run ./scripts/scenario3.ts --network localhost
```
### Scenario 4: 120-Day Deadlock & Pro-Rata Refunds
- **File:** `scenario4.ts`
- **Description:** Tests project abandonment. 120 days pass without a milestone execution. Investors unstake their tokens and surrender them via `refundDeadProject()` to claim their exact mathematical share of the remaining locked ETH.
```bash
docker-compose exec hardhat npx hardhat run ./scripts/scenario4.ts --network localhost
```

## 🟡 Revenue & Utility Scenarios

### Scenario 5: SaaS Revenue Routing (24/1/75 Split)
- **File:** `scenario5.ts`
- **Description:** A customer pays for a SaaS subscription. Verifies the `RevenueRouter` perfectly splits the payment: 1% to the Treasury, 24% to the Developer's pull ledger, and 75% pushed to the `DividendDistributor` for staked investors to claim.
```bash
docker-compose exec hardhat npx hardhat run ./scripts/scenario5.ts --network localhost
```
### Scenario 6: Zero-Staker Revenue Fallback
- **File:** `scenario6.ts`
- **Description:** Tests the `RevenueRouter` edge case where a SaaS payment arrives, but no investors are currently staked. Verifies the transaction does not revert, and the unallocated 75% yield safely defaults to the developer's operating runway.
```bash
docker-compose exec hardhat npx hardhat run ./scripts/scenario6.ts --network localhost
```
### Scenario 7: Secondary Market (Native P2P Exchange)
- **File:** `scenario7.ts`
- **Description:** Tests the non-custodial OTC order desk. An investor lists tokens for a fixed ETH price. A buyer fills the order. Verifies the secure atomic swap and the 1% secondary trading fee routed to the platform Treasury.
```bash
docker-compose exec hardhat npx hardhat run ./scripts/scenario7.ts --network localhost
``` 
## 🔴 Governance & Edge Case Scenarios

### Scenario 8: 28-Day Quorum Fallback Execution
- **File:** `scenario8.ts`
- **Description:** Tests voter apathy mitigation. A milestone receives only 30% YES votes (failing the >50% Fast-Track). The EVM fast-forwards 28 days. Because 30% meets the minimum 20% quorum, the milestone executes successfully.
```bash
docker-compose exec hardhat npx hardhat run ./scripts/scenario8.ts --network localhost
```
### Scenario 9: Soft-Cap Failure (Missed Funding Deadline)
- **File:** `scenario9.ts`
- **Description:** Tests an underfunded campaign. The 30-day funding timer expires before the goal is reached. Investors call `refundFailedCrowdfund()` to retrieve 100% of their raw ETH deposits.
```bash
docker-compose exec hardhat npx hardhat run ./scripts/scenario9.ts --network localhost
``` 
### Scenario 10: Sybil Vote-Lock Exploit Protection
- **File:** `scenario10.ts`
- **Description:** Proves that an investor cannot double-vote. Once an investor casts a vote on an active milestone, the `DividendDistributor` actively blocks them from withdrawing their tokens, physically preventing Sybil transfers until the poll closes.
```bash
docker-compose exec hardhat npx hardhat run ./scripts/scenario10.ts --network localhost
```     
### Scenario 11: Developer Role Migration
- **File:** `scenario11.ts`
- **Description:** Tests the two-step developer transfer protocol. The active developer proposes a new wallet address. The new address accepts. Verifies that milestone payouts and permissions securely migrate to the new address.
```bash
docker-compose exec hardhat npx hardhat run ./scripts/scenario11.ts --network localhost
``` 