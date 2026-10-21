import { network } from "hardhat";

async function main() {
    // Hardhat 3 dynamic initialization
    const { ethers } = await network.create();

    const [deployer] = await ethers.getSigners();
    console.log(`Deploying contracts with the account: ${deployer.address}`);

    const balance = await ethers.provider.getBalance(deployer.address);
    console.log(`Account balance: ${ethers.formatEther(balance)} ETH`);

    if (balance === 0n) {
        throw new Error("Deployer account has 0 ETH. Please use a Sepolia faucet.");
    }

    // The Treasury address (can be the deployer wallet or a separate multi-sig)
    const treasuryAddress = deployer.address;

    const Factory = await ethers.getContractFactory("ForgeCapitaFactory");
    console.log("Deploying ForgeCapitaFactory (this may take a minute)...");

    const factory = await Factory.deploy(treasuryAddress);
    await factory.waitForDeployment();

    const factoryAddress = await factory.getAddress();
    const p2pAddress = await factory.p2pExchange();

    console.log(`✅ ForgeCapitaFactory deployed to: ${factoryAddress}`);
    console.log(`✅ P2PExchange automatically deployed to: ${p2pAddress}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});