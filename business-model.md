## ForgeCapita Business Model Architecture

### 1. Capital Formation & Token Partitioning

* **The Funding Base:** Startups raise funding strictly in ETH, which is secured in the `MilestoneEscrow`.


* **Fixed Token Supply:** Every project launches with an immutable fixed supply representing fractional SaaS yield rights.


* **80% Public Investor Allocation:** Backers claim their pro-rata share of 80% of the token supply based on their initial ETH contribution. During the development phase, these tokens represent 100% of the active voting power.


* **20% Developer Equity Allocation:** The founder's equity is strictly cliff-vested. These tokens are locked in the escrow and only transferred to the developer once 100% of the milestones are successfully executed.



### 2. Apathy-Proof Governance (Vote-Escrow Model)

* **Unified Staked-Governance:** Voting power is not determined by liquid wallet balances, but strictly by the number of tokens locked inside the `DividendDistributor`.


* **Sybil Protection (Dynamic Lock):** If an investor casts a vote on an active milestone, their staked tokens are cryptographically locked inside the `DividendDistributor` and cannot be withdrawn or transferred to a secondary wallet until the voting round closes.


* **Dual-Path Execution:** Milestones execute instantly via the Fast-Track if $>50\%$ of the public supply votes "Yes". If voter apathy occurs, the Quorum Fallback executes the milestone after 28 days, provided at least $20\%$ of the public supply participated and $\text{yesVotes} > \text{noVotes}$.


* **120-Day Deadlock Refund:** If a milestone fails or stalls for 120 days, the project enters a deadlock. Investors can surrender their tokens to claim a pro-rata refund of the remaining ETH. The developer is mathematically barred from claiming this refund.



### 3. Recurring SaaS Monetization (The 24/1/75 Split)

* **24% Developer OpEx Cut:** The `RevenueRouter` routes 24% of all gross SaaS subscription revenue to the developer's pull ledger, ensuring they always have liquid working capital to pay for cloud hosting and APIs.


* **1% Protocol Toll:** The platform treasury continuously extracts a 1% fee from all incoming SaaS revenue.


* **75% Passive Dividend Pool:** The remaining 75% of revenue is instantly pushed to the `DividendDistributor`. Investors actively staking their `ProjectToken`s earn a proportional, high-water mark yield of this ETH.


* **Zero-Staker Fallback:** If zero investors have staked their tokens when a customer pays for a subscription, the unallocated 75% defaults to the developer rather than causing a system-wide payment revert.



### 4. Secondary Market Liquidity (Native P2P Exchange)

* **AMM Independence:** The platform bypasses Uniswap liquidity pools completely, preserving 100% of the crowdfunded ETH for developer milestones and preventing the steep price crashes inherent to shallow AMMs.


* **Non-Custodial OTC Desk:** Early backers can exit their positions by listing exact token amounts for a fixed ETH asking price on the native `P2PExchange`.


* **Secondary Market Fee:** The platform extracts a 1% marketplace fee on all successfully executed secondary trades, creating a third revenue stream for the `forgeCapitaTreasury` alongside the 5% initial capital formation fee and the 1% recurring SaaS toll.