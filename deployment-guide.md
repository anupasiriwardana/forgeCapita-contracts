Here is the comprehensive, step-by-step guide documenting the exact process we followed to take the `forgeCapita-v2` smart contracts from local testing to a live, verified state on the public Ethereum Sepolia Testnet.

You can save this directly as `deployment-guide.md` in your project repository for future reference.

---

# ForgeCapita-v2: Testnet Deployment & Verification Guide

This document outlines the end-to-end process executed after the completion of the local Hardhat test suite (Scenarios 1-11). It covers testnet preparation, funding, deployment, and public source-code verification, including the reasoning and troubleshooting behind each step.

---

## Phase 1: Preparing for a Public Testnet

After proving the contracts were mathematically sound on a local, simulated blockchain, the next step was deploying them to a public network.

**Why Sepolia?**
We chose the **Ethereum Sepolia Testnet** because it perfectly mimics the live Ethereum Mainnet but uses valueless test ETH. This allows developers to test live network latency, external integrations, and wallet interactions (like MetaMask) completely free of charge.

### Step 1.1: Securing the Deployer Wallet

To deploy a contract, Hardhat needs a wallet's Private Key to sign the transaction. Hardcoding a private key into a script is a massive security risk.

**What we did:**

1. Installed the `dotenv` package (`npm install dotenv`) to manage environment variables.
2. Extracted the private key from a MetaMask testing account.
3. Created a `.env` file in the project root to securely store the key outside the codebase.

**Why we did it:**
If a project is uploaded to GitHub with a hardcoded private key, automated bots will scrape the key within seconds and permanently compromise the wallet. The `.env` file keeps the key local and secure.

---

## Phase 2: Acquiring Testnet Gas (ETH)

Every transaction on a blockchain requires "Gas" (a computation fee paid in ETH). Because local Hardhat nodes provide fake accounts with 10,000 ETH automatically, we had to manually acquire Sepolia ETH for the public testnet.

### Step 2.1: The Faucet Route & Troubleshooting

We attempted to use public "Faucets"—services that drip free testnet ETH to developers.

* **Attempt 1: Chainlink Faucet**
* *What happened:* The transaction failed. The faucet successfully sent 25 Testnet LINK tokens, but the ETH request was rejected.
* *Why it failed:* Chainlink implemented a spam-prevention rule requiring the requesting wallet to hold at least 1 Mainnet LINK token (real money) to prove they are a human developer, not a bot. Our fresh test wallet was empty.


* **Attempt 2: Google Cloud Web3 Faucet**
* *What happened:* Success. We navigated to `[cloud.google.com/application/web3/faucet](https://cloud.google.com/application/web3/faucet)`, input the public wallet address (`0x08D...`), and received 0.05 Sepolia ETH.
* *Why it worked:* Google uses standard Google Account authentication to prevent bot spam instead of requiring mainnet balances, making it the ideal fallback for fresh wallets.



### Step 2.2: Verifying the Funds

To confirm the funds arrived, we switched MetaMask's network from "Ethereum Mainnet" to "Sepolia" (by enabling "Show test networks" in settings). We also verified the balance on the public ledger using `sepolia.etherscan.io`.

---

## Phase 3: Configuring Hardhat for Sepolia

With a funded wallet, we needed to instruct Hardhat on how to communicate with the Sepolia blockchain.

**What we did:**
We updated `hardhat.config.ts` to include a `sepolia` network profile reading from our `.env` file:

```typescript
import * as dotenv from "dotenv";
dotenv.config();

// Inside defineConfig:
networks: {
  sepolia: {
    type: "http",
    chainType: "l1",
    url: process.env.SEPOLIA_RPC_URL || "", // Set to https://sepolia.drpc.org
    accounts: process.env.SEPOLIA_PRIVATE_KEY ? [process.env.SEPOLIA_PRIVATE_KEY] : [],
  },
}

```

**Why we did it:**
Hardhat needs an RPC (Remote Procedure Call) node to broadcast the deployment transaction. Instead of signing up for a paid provider like Alchemy, we used a free public endpoint (`[https://sepolia.drpc.org](https://sepolia.drpc.org)`). We mapped the `accounts` array to the private key in the `.env` file so Hardhat could sign the deployment automatically.

---

## Phase 4: The Deployment Script

We created `scripts/deploy.ts` to execute the actual deployment of the `ForgeCapitaFactory` and initialize the platform.

**What we did:**

1. Imported `network` from Hardhat 3 and initialized `ethers` dynamically (`const { ethers } = await network.create();`).
2. Set the `treasuryAddress` to the deployer's wallet.
3. Executed `Factory.deploy(treasuryAddress)`.
4. Retrieved both the Factory address and the internally generated `P2PExchange` address.

**Execution:**

```bash
npx hardhat run ./scripts/deploy.ts --network sepolia

```

**Why we did it this way:**
The `ForgeCapitaFactory` constructor requires a treasury address to route the 5% platform fees and 1% secondary trading tolls. By executing this script via the `--network sepolia` flag, Hardhat compiled the Solidity code into bytecode, signed it with our funded `.env` wallet, and permanently etched it onto the Sepolia blockchain.

---

## Phase 5: Smart Contract Source Code Verification

After deployment, the contract was live at `0x0a72...`, but Etherscan only displayed it as raw, unreadable hexadecimal bytecode.

**Why we verified it:**
In Web3, "Trust but Verify" is the golden rule. If a contract's source code is not publicly visible on the block explorer, investors assume it is a scam. Verifying the contract proves that the bytecode matches our local Solidity files exactly, and it unlocks Etherscan's graphical UI, allowing users to "Read" and "Write" to the contract directly from the browser.

### Step 5.1: API Keys and Config

1. Created a free account on Etherscan and generated an API Key.
2. Added `ETHERSCAN_API_KEY` to the `.env` file.
3. Added the `verify` object to `hardhat.config.ts`:
```typescript
verify: {
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY || "",
  },
},

```



### Step 5.2: The Checksum Error (EIP-55)

We ran the verification command passing the deployed factory address and the treasury constructor argument.

* *The Command:* `npx hardhat verify --network sepolia <FACTORY_ADDRESS> "0x08D3B185..."`
* *The Error:* `bad address checksum (INVALID_ARGUMENT)`
* *Why it happened:* Ethereum uses EIP-55, a standard that mixes uppercase and lowercase letters in a wallet address to act as a built-in typo checker. Etherscan strictly enforces this. Our copied address had mismatched casing for the checksum standard.
* *The Fix:* We bypassed the strict checking by passing the constructor argument in **all lowercase letters** (`"0x08d3b185..."`). Hardhat's internal `ethers` library accepted the lowercase string and automatically recalculated the mathematically perfect EIP-55 checksum before sending it to Etherscan.

### Step 5.3: Successful Verification

The command succeeded. The terminal output confirmed verification on both **Etherscan** and **Blockscout**. (A minor `429: Too Many Requests` error appeared for *Sourcify*, which was safely ignored as it merely indicated a third-party server was temporarily overloaded and had no bearing on our Etherscan success).

**The Result:**
The `ForgeCapitaFactory` is now fully verified. The Solidity code is completely transparent, and the ecosystem is officially ready to be integrated with a Web3 frontend.

---