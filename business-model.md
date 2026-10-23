# ForgeCapita Business Model Architecture

### 1. Capital Formation & Token Partitioning
*   **The Funding Base:** Startups raise funding strictly in the native gas token of their chosen network (ETH on Arbitrum, BNB on BNB Chain), which is secured in the `MilestoneEscrow`.
*   **Minimum Funding Goals:** To mathematically protect the platform treasury from unprofitable micro-raises, the frontend enforces mandatory minimum funding goals based on the chosen network's average gas baseline.
*   **Fixed Token Supply:** Every project launches with an immutable fixed supply representing fractional SaaS yield rights.
*   **80% Public Investor Allocation:** Backers claim their pro-rata share of 80% of the token supply based on their initial contribution. During the development phase, these tokens represent 100% of the active voting power.
*   **20% Developer Equity Allocation:** The founder's equity is strictly cliff-vested. These tokens are locked in the escrow and only transferred to the developer once 100% of the milestones are successfully executed.

### 2. Apathy-Proof Governance (Vote-Escrow Model)
*   **Unified Staked-Governance:** Voting power is not determined by liquid wallet balances, but strictly by the number of tokens locked inside the `DividendDistributor`.
*   **Sybil Protection (Dynamic Lock):** If an investor casts a vote on an active milestone, their staked tokens are cryptographically locked inside the `DividendDistributor` and cannot be withdrawn or transferred to a secondary wallet until the voting round closes.
*   **Dual-Path Execution:** Milestones execute instantly via the Fast-Track if $>50\%$ of the public supply votes "Yes". If voter apathy occurs, the Quorum Fallback executes the milestone after 28 days, provided at least $20\%$ of the public supply participated and $\text{yesVotes} > \text{noVotes}$.
*   **120-Day Deadlock Refund:** If a milestone fails or stalls for 120 days, the project enters a deadlock. Investors can surrender their tokens to claim a pro-rata refund of the remaining locked capital.

### 3. Recurring SaaS Monetization (The 24/1/75 Split)
*   **24% Developer OpEx Cut:** The `RevenueRouter` routes 24% of all gross SaaS subscription revenue to the developer's pull ledger, ensuring working capital for cloud hosting and APIs.
*   **1% Protocol Toll:** The platform treasury continuously extracts a 1% fee from all incoming SaaS revenue.
*   **75% Passive Dividend Pool:** The remaining 75% of revenue is instantly pushed to the `DividendDistributor`. Staking investors earn a proportional yield.
*   **Zero-Staker Fallback:** If zero investors are staked when a customer pays for a subscription, the unallocated 75% defaults to the developer.

### 4. Secondary Market Liquidity (Native P2P Exchange)
*   **AMM Independence:** Bypasses AMM liquidity pools completely, preserving 100% of the crowdfunded capital for developer milestones.
*   **Non-Custodial OTC Desk:** Early backers can exit positions by listing exact token amounts for a fixed asking price on the native `P2PExchange`.
*   **Secondary Market Fee:** The platform extracts a 1% marketplace fee on all successfully executed secondary trades.

### 5. Gas Abstraction & Operation-Based Fee Routing
To maximize retail onboarding, ForgeCapita implements an ERC-4337 Account Abstraction architecture. A hybrid system handles network fees, utilizing an Off-Chain API (The Brain) to track gas prices and sign valid transactions, and an On-Chain Smart Contract (The Vault) to pay the gas.

**Operation-Specific Fee Delegation:**
*   **Launch Project:** The Founder pays their own standard network gas. (Paymaster bypassed).
*   **P2P Trading & Yield Claiming:** The Investor pays their own network gas, as these operations strictly benefit the individual. (Paymaster bypassed).
*   **Project Funding & Milestone Voting:** The ForgeCapita Treasury Paymaster pays the network gas upfront to provide a frictionless, free experience for the investor. 
    *   *The Recoupment Mechanism:* The Paymaster tracks the exact gas debt per project. When a milestone succeeds, the smart contract deducts the standard **flat 5% platform fee** PLUS the accumulated gas debt from the escrowed funds before transferring the rest to the founder.

**Dynamic Congestion Handling (Etherscan 24h Average):**
*   When a user initiates a sponsored action (e.g., Voting), the off-chain Paymaster API queries the Etherscan Gas Tracker.
*   If the current gas price is *below* the 24-hour average, the API signs the transaction, and the Treasury pays the fee.
*   If the current network fee is *above* the 24-hour limit (network spike), the API refuses to sign, preventing treasury depletion. The frontend gracefully falls back, allowing the user to either queue their intent (to be executed automatically when gas drops) or pay the fee manually via their own Web3 wallet.

### 6. Dynamic Gas Abstraction & Fee Routing (ERC-4337)
This section defines how network fees are handled for every smart contract interaction. The system uses a hybrid off-chain API Paymaster to track the Etherscan 24-hour network gas average and routes the gas burden dynamically based on the operation type and current congestion levels.

* **Founder Operations (Launch Project, Close Funding, Start Milestone, Execute Milestone)**
    * *Below & Above Average:* The Paymaster is bypassed completely. The founder pays 100% of the network gas directly from their own wallet, regardless of network congestion.
* **Pro-Project Operations (Fund Project, Vote on Milestone)**
    * *Below Average:* ForgeCapita Treasury fully subsidizes the gas fee (covered by the 5% initial platform fee). The investor experiences a zero-gas transaction.
    * *Above Average (Congested):* The Treasury subsidizes 100% upfront to ensure the transaction executes without stalling. The excess gas cost (the spike amount minus the 24-hour average) is logged as debt and deducted directly from the founder's escrowed funds upon successful milestone completion.
* **Investor Reward & State Operations (Claim Tokens, Stake Tokens, Claim SaaS Yields, Claim Refund)**
    * *Below Average:* ForgeCapita Treasury fully subsidizes the gas fee.
    * *Above Average (Congested):* The Treasury subsidizes the gas only up to the Etherscan 24-hour average. The investor must pay the remaining excess gas out of pocket to execute their transaction during the network spike.
* **Secondary Market Operations (Create Listing, Buy P2P Tokens)**
    * *Below & Above Average:* The Treasury provides zero gas subsidies. Investors must pay 100% of the network fees directly from their own wallets to interact with the P2P exchange at all times.