import hardhatToolboxMochaEthersPlugin from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import { defineConfig, configVariable } from "hardhat/config";
import * as dotenv from "dotenv";

dotenv.config();

export default defineConfig({
  plugins: [hardhatToolboxMochaEthersPlugin],
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          viaIR: true,
        },
      },
      production: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          viaIR: true,
        },
      },
    },
  },
  networks: {
    hardhat: {
      type: "edr-simulated"
    },
    arbitrumSepolia: {
      type: "http",
      url: process.env.ARBITRUM_SEPOLIA_RPC || "",
      accounts: [configVariable("DEPLOYER_KEY")],
      chainId: 421614,
    },
    bscTestnet: {
      type: "http",
      url: process.env.BSC_TESTNET_RPC || "https://data-seed-prebsc-1-s1.binance.org:8545",
      accounts: [configVariable("DEPLOYER_KEY")],
      chainId: 97,
    },
  },
  verify: {
    etherscan: {
      apiKey: process.env.ARBISCAN_API_KEY || "",
      customChains: [
        {
          network: "arbitrumSepolia",
          chainId: 421614,
          urls: {
            apiURL: "https://api-sepolia.arbiscan.io/api",
            browserURL: "https://sepolia.arbiscan.io/",
          },
        },
        {
          network: "bscTestnet",
          chainId: 97,
          urls: {
            apiURL: "https://api-testnet.bscscan.com/api",
            browserURL: "https://testnet.bscscan.com/",
          },
        },
      ],
    },
  }
});