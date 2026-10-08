# forgeCapita-contracts



This repository contains the immutable Web3 smart contract infrastructure for the ForgeCapita ecosystem. Built with Solidity and Hardhat, it operates as a trustless crowdfunding and yield distribution engine for software developers.

## 🏗 Core Smart Contracts

The ecosystem is driven by five deeply integrated contracts.

* **`ForgeCapitaFactory.sol`:** The master deployment engine. It guarantees a flawless, atomic deployment of the entire startup architecture in a single transaction, eliminating human error or malicious wiring. It takes the platform's treasury address upon deployment to enforce global fee structures.


* **`ProjectToken.sol`:** An ERC-20 token representing fractional equity. It relies on a fixed-supply model with 18 decimals, minted entirely to the Escrow contract during factory deployment. It includes a public `burn` function for deflationary mechanics.


* **`MilestoneEscrow.sol`:** A trustless vault protecting investor capital. It utilizes a "Pull-over-Push" mechanism (`claimTokens`) for token distribution. It enforces a 5% platform success fee at closing, 90-day deadlock timeouts, and strict absolute-majority (>50%) community voting requirements to release funding tranches.


* **`DividendDistributor.sol`:** A gas-efficient staking contract that calculates investor yield. It uses a Magnified Dividend Per Share (High-Water Mark) algorithm mapped with a `1e18` multiplier to distribute ETH proportionally across staked tokens without vulnerable looping.


* **`RevenueRouter.sol`:** An automated payment splitter intercepting incoming SaaS revenue. It utilizes a "Pull" mechanism for the developer (39% cut) and the ForgeCapita treasury (1% toll) to prevent Reentrancy and DoS exploits. It utilizes a "Push" mechanism for investors, instantly pushing 60% of the payment directly into the `DividendDistributor`.



## 🔄 The "Dependency Dance" (System Lifecycle)

Because the contracts rely on each other, they follow a strict deployment and operational lifecycle:

1. **Deployment:** A developer calls `launchProject()` on the Factory. The Factory deploys the `ProjectToken`, then deploys the `MilestoneEscrow` and locks 100% of the tokens inside it. It then deploys the `DividendDistributor` and the `RevenueRouter`, hardwiring the addresses together.


2. **Crowdfunding:** Investors deposit ETH into the `MilestoneEscrow`. If the soft-cap goal is reached, the developer locks the vault. Investors execute `claimTokens()` to pull their proportional equity.


3. **Milestone Execution:** Investors cast token-weighted votes (`vote()`) to approve project milestones. Once strictly >50% of the entire token supply votes "Yes," the developer can trigger `executeMilestone()` to unlock their tranche of ETH.


4. **Staking:** Investors approve and deposit their tokens into the `DividendDistributor` to activate their passive yield.


5. **Revenue Distribution:** A customer pays ETH directly to the `RevenueRouter`. The 60% investor cut is instantly pushed to the `DividendDistributor`, raising the global high-water mark. The developer and treasury call their respective pull functions on the Router to claim their cuts.



## ⚙️ Prerequisites & Setup

Ensure you have **Docker** and **Docker Compose** installed on your host machine. The container includes Node 22, Hardhat 3, and all OpenZeppelin dependencies.

Boot the isolated Linux environment:

```bash
docker-compose up -d --build hardhat

```

Open a bash terminal inside the running container:

```bash
docker-compose exec hardhat bash

```

## 🛠 Compilation & Deployment

Execute the following commands from within the container terminal to compile the Solidity code using the optimized Hardhat profile and deploy the master factory to the local node.

1. **Compile the Contracts:**

```bash
npx hardhat compile

```

2. **Start the Local Blockchain (Run in a dedicated terminal tab):**

```bash
npx hardhat node

```

3. **Deploy the Factory (Open a second container terminal):**

```bash
npx hardhat ignition deploy ./ignition/modules/ForgeCapitaFactory.ts --network localhost

```

## 🧪 Testing Suite

This repository features 10 comprehensive simulation scripts mimicking real-world behaviors and exploits. See `scripts/testguide.md` for a full breakdown of each scenario.

Run tests using the following command structure against your local network:

```bash
npx hardhat run ./scripts/scenario1.ts --network localhost

```