import { network } from "hardhat";

async function main() {
    const { ethers } = await network.create();
    const [deployer] = await ethers.getSigners();

    console.log(`Deploying contracts with the account: ${deployer.address}`);
    
    const balance = await ethers.provider.getBalance(deployer.address);
    console.log(`Account balance: ${ethers.formatEther(balance)} ETH`);

    if (balance === 0n) {
        throw new Error("Deployer account has 0 ETH. Please use a faucet.");
    }

    console.log("1. Deploying ForgeCapitaRegistry...");
    console.log(`  Admin (initial treasury AND Guardian) = deployer: ${deployer.address}`);
    const Registry = await ethers.getContractFactory("ForgeCapitaRegistry");
    const registry = await Registry.deploy(deployer.address);
    await registry.waitForDeployment();
    const registryAddress = await registry.getAddress();
    console.log(`  ForgeCapitaRegistry deployed to: ${registryAddress}`);

    console.log("\n2. Deploying Master Implementation Contracts...");
    
    const Token = await ethers.getContractFactory("ProjectToken");
    const masterToken = await Token.deploy();
    await masterToken.waitForDeployment();
    console.log(`  Master Token deployed to:       ${masterToken.target}`);

    const Escrow = await ethers.getContractFactory("MilestoneEscrow");
    const masterEscrow = await Escrow.deploy();
    await masterEscrow.waitForDeployment();
    console.log(`  Master Escrow deployed to:      ${masterEscrow.target}`);

    const Distributor = await ethers.getContractFactory("DividendDistributor");
    const masterDistributor = await Distributor.deploy();
    await masterDistributor.waitForDeployment();
    console.log(`  Master Distributor deployed to: ${masterDistributor.target}`);

    const Router = await ethers.getContractFactory("RevenueRouter");
    const masterRouter = await Router.deploy();
    await masterRouter.waitForDeployment();
    console.log(`  Master Router deployed to:      ${masterRouter.target}`);


    console.log("\n3. Deploying ForgeCapitaFactory (Proxy Router)...");
    const Factory = await ethers.getContractFactory("ForgeCapitaFactory");
    const factory = await Factory.deploy(
        masterToken.target,
        masterEscrow.target,
        masterDistributor.target,
        masterRouter.target,
        registryAddress
    );
    
    await factory.waitForDeployment();
    const factoryAddress = await factory.getAddress();
    const p2pAddress = await factory.p2pExchange();

    console.log(`  ForgeCapitaFactory deployed to: ${factoryAddress}`);
    console.log(`  P2PExchange automatically deployed to: ${p2pAddress}`);
    console.log("\nNext: the Guardian (deployer) must run scripts/postDeployConfig.ts to set the relayer and gas caps.");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
