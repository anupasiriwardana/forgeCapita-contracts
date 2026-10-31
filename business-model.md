# ForgeCapita V3 Business Model Architecture

### 1. Capital Formation & Token Partitioning
* **The Funding Base:** Startups raise funding strictly in the native gas token of their chosen network (ETH on Arbitrum, BNB on BNB Chain), which is secured in the `MilestoneEscrow`.
* **Platform Fee & Minimum Funding Goals:** The protocol extracts a flat 5% platform fee from the total capital raised when funding closes. To protect the platform treasury from unprofitable micro-raises, the API computes a minimum funding goal live for the chosen network (the gas a project needs, for example 100 investors and 5 milestones, priced at the 24-hour average gas price with a safety margin, divided by the 5% fee) and the frontend shows it. It is guidance shown to founders, not enforced by the contract.
* **Fixed Token Supply:** Every project launches with an immutable fixed supply representing fractional SaaS yield rights.
* **80% Public Investor Allocation:** Backers claim their pro-rata share of 80% of the token supply based on their initial contribution. During the development phase, these tokens represent 100% of the active voting power.
* **20% Developer Equity Allocation:** The founder's equity is strictly cliff-vested. These tokens are locked in the escrow and only transferred to the developer once 100% of the milestones are successfully executed.
* **Stuck Funding Protection:** If the goal is reached but the founder never closes funding, the founder has 14 days after the funding deadline to do so. After that, investors can pull back their full deposits (no fee is taken).

### 2. Apathy-Proof Governance (Vote-Escrow Model)
* **Unified Staked-Governance:** Voting power is not determined by liquid wallet balances, but strictly by the number of tokens locked inside the `DividendDistributor`.
* **Sybil Protection (Dynamic Lock):** If an investor casts a vote on an active milestone, their staked tokens are cryptographically locked inside the `DividendDistributor` and cannot be withdrawn or transferred to a secondary wallet until the voting round closes.
* **Dual-Path Execution:** Milestones execute instantly via the Fast-Track if >50% of the public supply votes "Yes". If voter apathy occurs, the Quorum Fallback executes the milestone after the 28-day voting period (extended by any time the Guardian froze the project), provided at least 20% of the public supply participated and `yesVotes > noVotes`.
* **Failed Vote Refund:** If the voting period ends without approval, `executeMilestone()` (callable by anyone) cancels the project and opens refunds: investors surrender their tokens to claim a pro-rata share of the remaining locked capital. The developer is mathematically barred from claiming this refund. Before the on-chain vote, an off-chain discussion room gives investors and the founder at least 30 days to talk; there is no fixed inactivity deadline, and a stalled developer is handled by the Guardian (cancel or propose a replacement).
* **Refund Window:** Refunds stay open for 90 days after a cancel. Refunds are always paid by the investor and are never sponsored.

### 3. Recurring SaaS Monetization (The 24/1/75 Split)
* **24% Developer OpEx Cut:** The `RevenueRouter` routes 24% of all gross SaaS subscription revenue to the developer's pull ledger, ensuring liquid working capital for cloud hosting and APIs.
* **1% Protocol Toll:** The platform treasury continuously extracts a 1% fee from all incoming SaaS revenue.
* **75% Passive Dividend Pool:** The remaining 75% of revenue is instantly pushed to the `DividendDistributor`. Investors actively staking their `ProjectToken`s earn a proportional, high-water mark yield.
* **Zero-Staker Fallback:** If zero investors are staked when a customer pays for a subscription, the unallocated 75% defaults to the developer rather than causing a payment revert.

### 4. Secondary Market Liquidity (Native P2P Exchange)
* **AMM Independence:** Bypasses automated market maker (Uniswap/PancakeSwap) liquidity pools completely, preserving 100% of the crowdfunded capital for developer milestones and preventing shallow-pool price crashes.
* **Non-Custodial OTC Desk:** Early backers can exit positions by listing exact token amounts for a fixed asking price on the native `P2PExchange`.
* **Secondary Market Fee:** The platform extracts a 1% marketplace fee on all successfully executed secondary trades, creating a third revenue stream alongside the 5% initial capital formation fee and the 1% recurring SaaS toll.

### 5. Gasless Relayer & On-Chain Gas Ledger (contracts v2)
The ERC-4337 Paymaster design of v1 is retired (v1 is archived by the `v1-testnet` tag). Contracts v2 gives users free gas for four actions without account abstraction, so a plain wallet is enough. The design combines EIP-1167 Minimal Proxies (~90% deployment gas reduction) with a relayer and a small on-chain ledger:

* **The Relayer:** a server-held hot wallet, allow-listed in the shared per-chain `ForgeCapitaRegistry`, that submits the gasless transactions and pays their gas. It is separate from the treasury wallet and can do nothing else.
* **Signed Actions:** voting uses a free EIP-712 signature, staking uses a free ERC-2612 permit signature, and claiming tokens needs no signature (the tokens can only go to the depositor). The contracts check signatures (plain or ERC-1271 wallets), deadlines and the relayer allow-list.
* **Gas Ledger (budget = the 5% fee):** the treasury keeps the whole 5% fee and pays gas from it. Each project's `MilestoneEscrow` records the cost of every sponsored call (measured at the end of the call plus a fixed overhead per action, capped per action by the registry's `maxCostPerAction`, plus an Arbitrum data fee `l1Surcharge`) against a budget equal to that project's 5% fee.
* **Recoupment from Payouts:** gas beyond the budget is deducted from milestone payouts and sent to the treasury, at most 15% of each milestone release. The remainder carries over to the next milestone and is written off after the final one. The ceiling is the budget plus 15% of net funds; above it the relayer is refused and the user simply pays their own gas.
* **Queueing:** the web app shows a gas tracker (current price versus the 24-hour average). When fees are high, a signed request waits and is sent when they fall back to the average, for at most 6 hours (less when a vote is about to close).
* **Settings:** the Guardian can change `maxCostPerAction`, `l1Surcharge` and the relayer allow-list at any time without a redeploy.
* **No Treasury Signature:** `executeMilestone()` takes no arguments and no signature. Once a milestone is approved anyone can trigger it and the payout always goes to the developer.

### 6. Operation-by-Operation Gas Responsibility

1. **Sponsored by the Relayer (free for the user, within the project's gas ceiling):** `claimTokens`, `stake`, `vote` and `executeMilestone`. If the ceiling is reached the user pays their own gas.
2. **Always paid by the user:** `launchProject` (an anti-spam filter for founders), invest, `closeFundingAndStart`, `startMilestone`, `claimYield`, `withdraw` (unstake), `refundFailedCrowdfund`, `refundDeadProject`, revenue payments, P2P listings and fills, `proposeNewDeveloper`, `acceptDeveloperRole`, `cancelProject`, token approvals.
3. **Paid by the treasury/Guardian wallet:** the Guardian's own actions (freeze, cancel, emergency shutdown, registry settings) and the relayer's top-ups.

### 7. Protocol Emergency Admin Circuit Breaker & Total Supply Wipe
To protect the ecosystem against malicious founders, fraudulent campaigns, critical smart contract vulnerabilities, or regulatory compliance orders, the registry's Guardian (the admin wallet) retains an emergency circuit-breaker authority (`emergencyShutdown`), together with `cancelProject` and a milestone freeze (up to 45 days per freeze, 90 days in total):

* **Cancel First:** `emergencyShutdown` reverts ("Cancel project first") on a project that is neither cancelled nor completed. The Guardian first cancels the project, which halts deposits, milestone requests and founder payouts and opens refunds for investors.
* **Refund Window:** after a cancel, shutdown is allowed once every public token has been refunded or 90 days have passed. Investors pull their own refunds during this time; there is no off-chain payout.
* **Capital Sweep:** shutdown burns the tokens still held by the escrow and sweeps the native funds (ETH/BNB) left in the `MilestoneEscrow` (unclaimed refunds and dust) to the treasury.
* **Total Supply Wipe (Global Token Invalidation):** Rather than expensive iteration loops that fail against EVM block gas limits, the system triggers a global token invalidation flag via `ProjectToken.emergencyInvalidate()`. This flips a security modifier that makes the entire supply permanently untransferable, un-stakable, and dead across secondary markets and user wallets alike.
* **Completed Projects:** the Guardian may also shut down a completed project (kill switch). Such a project is then also flagged cancelled; clients check `completed` first.
* **Gas Handling:** the Guardian wallet pays 100% of the network gas for a shutdown and token wipe.
