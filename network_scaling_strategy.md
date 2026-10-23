# ForgeCapita: Network Scaling & Deployment Strategy

## 1. The Core Problem
During initial development and testing on the Ethereum Sepolia network, two critical infrastructure roadblocks were identified:

*   **Prohibitive Deployment & Runtime Costs:** The standard architecture required deploying heavy, customized bytecode for the `Factory`, `Escrow`, `Token`, and `Router` contracts every time a founder launched a project. On Layer 1 Ethereum, this costs approximately ~0.0276 ETH ($82.00) per launch, creating a massive barrier to entry. Furthermore, standard investor actions (funding, voting) incur $3-$5 gas fees, destroying the frictionless Web2 UX required for retail crowdfunding.
*   **The EIP-170 Compilation Limit:** The Ethereum Virtual Machine (EVM) enforces a strict $24.576 \text{ KB}$ maximum size limit for smart contracts. Attempting to bundle the ERC-20 logic, voting logic, and escrow management into a single, unified deployment repeatedly failed to compile.

## 2. The Architectural Solution

To achieve near-zero gas fees and bypass the compilation limits without introducing the immense developer complexity of Omnichain messaging (e.g., LayerZero/CCIP), ForgeCapita will implement an **Isolated Multi-Chain Proxy Architecture**.

### A. Isolated Multi-Chain Targeting
Instead of forcing users to pay Layer 1 bridging fees or wait out 7-day withdrawal periods for cross-chain execution, the platform will be deployed natively to two distinct, isolated EVM-compatible networks:
1.  **Arbitrum (Layer 2):** Captures the massive, deep liquidity of Ethereum-native DeFi. Gas is paid in ETH, and transactions cost $< \$0.01$.
2.  **BNB Smart Chain (Alt-L1):** Captures a massive global retail audience. Gas is paid in BNB, and transactions cost $\sim \$0.02$.

Liquidity will remain isolated to the network the founder chooses at launch (a BNB Chain project cannot accept Arbitrum ETH). The frontend (via Wagmi) will seamlessly handle network switching for the user, while the backend (Ponder) will index data from both chains into a unified database.

### B. EIP-1167 Minimal Proxies (OpenZeppelin Clones)
To solve the 24KB limit and slash the deployment barrier, the project will utilize the OpenZeppelin `Clones` library:
*   **Modular Master Contracts:** The heavy logic will be split into separate files (e.g., `MasterToken.sol`, `MasterEscrow.sol`) to bypass the size limit. These master contracts will be deployed to the networks *only once*.
*   **45-Byte Clones:** When a founder launches a startup, the `ForgeCapitaFactory` will deploy 45-byte Minimal Proxies. These lightweight clones securely delegate all logic to the master contracts while maintaining their own independent balances.
*   **The Result:** Deployment costs are reduced by over 90%, dropping from $\$82.00$ to roughly $\$0.10$ on our target L2/Alt-L1 networks.