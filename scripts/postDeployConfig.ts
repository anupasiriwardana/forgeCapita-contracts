// RUN BY THE USER ONLY. This sends transactions and must be run by the Guardian account
// (the registry admin passed at deployment, by default the deployer). It is never run by Claude.
//
// Sets the relayer and the sponsored-gas parameters on a freshly deployed ForgeCapitaRegistry.
// Edit the two public addresses below (not secrets), then run it against the target network
// with the Guardian's key configured in your own Hardhat network setup, e.g.:
//   npx hardhat run scripts/postDeployConfig.ts --network <network name>
//
// Idempotent: re-running just rewrites the same values.
import { network } from "hardhat";

const REGISTRY_ADDRESS = "0x2e6A22fd249930b9F2905D1bD66443CbE366AacB";
const RELAYER_ADDRESS = "0x8a1Be9d8fd97658b6b0B8b537374FF6c3E41815b";

// Action indices in the registry: 0 Claim, 1 Stake, 2 Vote, 3 Execute.
const ACTION_LABELS = ["Claim", "Stake", "Vote", "Execute"] as const;

interface ChainConfig {
    name: string;
    maxCostPerAction: bigint;
    l1Surcharges: readonly [bigint, bigint, bigint, bigint];
}

const CHAIN_CONFIGS: Readonly<Record<string, ChainConfig>> = {
    "97": {
        name: "BSC Testnet",
        maxCostPerAction: 350_000_000_000_000n, // 3.5e14 wei
        l1Surcharges: [0n, 0n, 0n, 0n],
    },
    "421614": {
        name: "Arbitrum Sepolia",
        maxCostPerAction: 200_000_000_000_000n, // 2e14 wei
        l1Surcharges: [
            60_400_000_000_000n, // Claim   6.04e13
            60_100_000_000_000n, // Stake   6.01e13
            60_200_000_000_000n, // Vote    6.02e13
            60_300_000_000_000n, // Execute 6.03e13
        ],
    },
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

async function main() {
    if (REGISTRY_ADDRESS === ZERO_ADDRESS || RELAYER_ADDRESS === ZERO_ADDRESS) {
        throw new Error("Set REGISTRY_ADDRESS and RELAYER_ADDRESS at the top of this file first.");
    }

    const { ethers } = await network.create();
    const [guardianSigner] = await ethers.getSigners();

    const chainId = (await ethers.provider.getNetwork()).chainId.toString();
    const config = CHAIN_CONFIGS[chainId];
    if (!config) {
        throw new Error(`No configuration for chain id ${chainId}. Supported: ${Object.keys(CHAIN_CONFIGS).join(", ")}.`);
    }

    const registry = await ethers.getContractAt("ForgeCapitaRegistry", REGISTRY_ADDRESS);

    const guardian = await registry.guardian();
    if (guardian.toLowerCase() !== guardianSigner.address.toLowerCase()) {
        throw new Error(`Signer ${guardianSigner.address} is not the registry Guardian (${guardian}).`);
    }

    console.log(`Configuring registry ${REGISTRY_ADDRESS} on ${config.name} (chain ${chainId}) as Guardian ${guardian}`);

    console.log(`setRelayer(${RELAYER_ADDRESS}, true)`);
    await (await registry.setRelayer(RELAYER_ADDRESS, true)).wait();

    console.log(`setMaxCostPerAction(${config.maxCostPerAction})`);
    await (await registry.setMaxCostPerAction(config.maxCostPerAction)).wait();

    for (let action = 0; action < ACTION_LABELS.length; action++) {
        const value = config.l1Surcharges[action];
        console.log(`setL1Surcharge(${action} ${ACTION_LABELS[action]}, ${value})`);
        await (await registry.setL1Surcharge(action, value)).wait();
    }

    console.log("Done.");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
