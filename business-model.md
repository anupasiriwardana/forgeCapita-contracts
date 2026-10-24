# ForgeCapita V3 Business Model Architecture

### 1. Capital Formation & Token Partitioning
* **The Funding Base:** Startups raise funding strictly in the native gas token of their chosen network (ETH on Arbitrum, BNB on BNB Chain), which is secured in the `MilestoneEscrow`.
* **Platform Fee & Minimum Funding Goals:** The protocol extracts a flat 5% platform fee from the total capital raised when funding closes. To mathematically protect the platform treasury from unprofitable micro-raises, the frontend enforces mandatory minimum funding goals dynamically calculated from the chosen network's 24-hour average gas baseline.
* **Fixed Token Supply:** Every project launches with an immutable fixed supply representing fractional SaaS yield rights.
* **80% Public Investor Allocation:** Backers claim their pro-rata share of 80% of the token supply based on their initial contribution. During the development phase, these tokens represent 100% of the active voting power.
* **20% Developer Equity Allocation:** The founder's equity is strictly cliff-vested. These tokens are locked in the escrow and only transferred to the developer once 100% of the milestones are successfully executed.

### 2. Apathy-Proof Governance (Vote-Escrow Model)
* **Unified Staked-Governance:** Voting power is not determined by liquid wallet balances, but strictly by the number of tokens locked inside the `DividendDistributor`.
* **Sybil Protection (Dynamic Lock):** If an investor casts a vote on an active milestone, their staked tokens are cryptographically locked inside the `DividendDistributor` and cannot be withdrawn or transferred to a secondary wallet until the voting round closes.
* **Dual-Path Execution:** Milestones execute instantly via the Fast-Track if >50% of the public supply votes "Yes". If voter apathy occurs, the Quorum Fallback executes the milestone after 28 days, provided at least 20% of the public supply participated and `yesVotes > noVotes`.
* **120-Day Deadlock Refund:** If a milestone fails or stalls for 120 days, the project enters a deadlock. Investors can surrender their tokens to claim a pro-rata refund of the remaining locked capital. The developer is mathematically barred from claiming this refund.

### 3. Recurring SaaS Monetization (The 24/1/75 Split)
* **24% Developer OpEx Cut:** The `RevenueRouter` routes 24% of all gross SaaS subscription revenue to the developer's pull ledger, ensuring liquid working capital for cloud hosting and APIs.
* **1% Protocol Toll:** The platform treasury continuously extracts a 1% fee from all incoming SaaS revenue.
* **75% Passive Dividend Pool:** The remaining 75% of revenue is instantly pushed to the `DividendDistributor`. Investors actively staking their `ProjectToken`s earn a proportional, high-water mark yield.
* **Zero-Staker Fallback:** If zero investors are staked when a customer pays for a subscription, the unallocated 75% defaults to the developer rather than causing a payment revert.

### 4. Secondary Market Liquidity (Native P2P Exchange)
* **AMM Independence:** Bypasses automated market maker (Uniswap/PancakeSwap) liquidity pools completely, preserving 100% of the crowdfunded capital for developer milestones and preventing shallow-pool price crashes.
* **Non-Custodial OTC Desk:** Early backers can exit positions by listing exact token amounts for a fixed asking price on the native `P2PExchange`.
* **Secondary Market Fee:** The platform extracts a 1% marketplace fee on all successfully executed secondary trades, creating a third revenue stream alongside the 5% initial capital formation fee and the 1% recurring SaaS toll.

### 5. Hybrid ERC-4337 Account Abstraction & Cryptographic Debt Recoupment
To provide a frictionless Web2-style experience without exposing the platform to infinite gas liability or expensive on-chain accounting overhead, ForgeCapita combines EIP-1167 Minimal Proxies (~90% deployment gas reduction) with a stateless ERC-4337 Paymaster architecture:

* **The Off-Chain Paymaster API ("The Brain"):** Queries the Etherscan/BscScan Gas Tracker API in real time to establish the 24-hour average gas price baseline. When a user initiates an operation, the API validates the target contract and function selector, compares current network gas against the 24-hour baseline, logs any excess congestion gas (`Actual Gas Cost - 24h Average Baseline`) in the off-chain database, and cryptographically signs valid `UserOperation` requests.
* **The On-Chain Paymaster Contract ("The Vault"):** Holds the ForgeCapita Treasury's native gas reserves (ETH/BNB) and sponsors transactions after verifying the off-chain API's signature via `validatePaymasterUserOp`.
* **Stateless Cryptographic Debt Recoupment (Signed Debt Parameter):** Rather than executing expensive `SSTORE` transactions to record gas debt on-chain during network spikes, excess gas debt is aggregated off-chain per project. When a founder calls `executeMilestone(uint256 gasDebt, bytes signature)`, the off-chain API signs a payload binding the `escrowAddress`, `currentMilestoneIndex`, `chainId`, and accumulated `gasDebt` using the `forgeCapitaTreasury` private key. The `MilestoneEscrow` contract verifies this ECDSA signature in memory, deducts `gasDebt` from the unlocked milestone tranche, transfers `gasDebt` directly to `forgeCapitaTreasury`, and releases the remaining payout to the founder in a single atomic transaction.

### 6. Operation-by-Operation Dynamic Gas Fee Routing

1. **Founder Initial Deployment (`launchProject`) — 100% Founder-Paid**
   * *Below & Above 24h Average:* The Paymaster is bypassed completely. The founder pays 100% of the network deployment gas directly from their own wallet, regardless of network congestion. This acts as an economic anti-spam filter against frivolous project launches.

2. **Core Project & Milestone Lifecycle Operations (`fund`, `closeFundingAndStart`, `startMilestone`, `vote`, `executeMilestone`) — Treasury-Subsidized with Signed Escrow Recoupment**
   * *Below 24h Average:* The ForgeCapita Treasury fully subsidizes 100% of the gas fee (covered by the 5% initial platform fee). Both founders and investors experience zero-gas transactions.
   * *Above 24h Average (Congested):* The Treasury still subsidizes 100% of the gas fee upfront so that project funding, governance voting, and milestone unlocks never stall or deadlock. The excess gas cost (the spike amount minus the 24-hour average) is accumulated off-chain as project debt and cryptographically passed into `executeMilestone(uint256 gasDebt, bytes signature)` to be deducted from the founder's escrowed funds upon milestone completion.

3. **Investor Reward & State Operations (`claimTokens`, `stake`, `withdraw`, `claimYield`, `refundFailedCrowdfund`, `refundDeadProject`) — Capped Treasury Subsidy**
   * *Below 24h Average:* The ForgeCapita Treasury fully subsidizes 100% of the gas fee.
   * *Above 24h Average (Congested):* The Treasury subsidizes the gas fee only up to the 24-hour average baseline. To execute immediately during a network spike, the investor must pay the remaining excess gas out of pocket (or wait for network gas to drop back below the 24-hour average).

4. **Secondary Market & Administrative Operations (`createListing`, `fillListing`, `cancelListing`, `proposeNewDeveloper`, `acceptDeveloperRole`, `cancelProject`) — 100% User-Paid**
   * *Below & Above 24h Average:* The Treasury provides zero gas subsidies. Users and developers must pay 100% of the network fees directly from their own wallets at all times.

### 7. Protocol Emergency Admin Circuit Breaker & Total Supply Wipe
To protect the ecosystem against malicious founders, fraudulent campaigns, critical smart contract vulnerabilities, or regulatory compliance orders, the `forgeCapitaTreasury` retains an emergency circuit-breaker authority (`emergencyShutdown`):

* **Immediate Project Freeze:** Invoking `emergencyShutdown` immediately sets `isFundingActive = false` and `projectCancelled = true`, permanently halting all deposits, milestone requests, voting rounds, and founder payouts.
* **Emergency Capital Extraction:** The contract sweeps 100% of any remaining native funds (ETH/BNB) locked inside the `MilestoneEscrow` directly to the `forgeCapitaTreasury` address for safekeeping or off-chain remediation.
* **Total Supply Wipe (Global Token Invalidation):** Rather than expensive iteration loops that fail against EVM block gas limits, the system triggers a global token invalidation flag via `ProjectToken.emergencyInvalidate()`. This immediately flips a security modifier across all token instances, rendering the entire supply permanently untransferable, un-stakable, and dead across secondary markets and user wallets alike.
* **Gas Handling:** The `forgeCapitaTreasury` admin wallet pays 100% of the network gas to execute an emergency shutdown and global token wipe.