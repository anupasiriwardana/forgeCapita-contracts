import { network } from "hardhat";

async function main() {
    const { ethers } = await network.create();
    const [developer, investor1, investor2] = await ethers.getSigners();

    // UPDATE THIS WITH YOUR ACTUAL FACTORY ADDRESS AFTER DEPLOYING
    const FACTORY_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3"; 

    const factory = await ethers.getContractAt("ForgeCapitaFactory", FACTORY_ADDRESS);

    console.log(`  Launching "Acme SaaS"...`);

    const tx = await factory.launchProject(
        "Acme SaaS", 
        "ACME", 
        1000000, 
        ["Full Project Delivery"],
        [100],
        ethers.parseEther("10"), // 10 ETH goal
        30 // 30 days
    );
    const receipt = await tx.wait();

    const filter = factory.filters.ProjectLaunched();
    const events = await factory.queryFilter(filter, receipt?.blockNumber, receipt?.blockNumber);
    const event = events[0] as any; 

    const tokenAddress = event.args[1];
    const escrowAddress = event.args[2];

    console.log(`  Project Deployed! Escrow is at: ${escrowAddress}`);

    const escrow = await ethers.getContractAt("MilestoneEscrow", escrowAddress);
    const token = await ethers.getContractAt("ProjectToken", tokenAddress); 

    console.log(`\n  1. CROWDFUNDING PHASE`);
    
    console.log(`   Investor 1 sending 3 ETH...`);
    const inv1BalBefore = await ethers.provider.getBalance(investor1.address);
    const tx1 = await investor1.sendTransaction({ to: escrowAddress, value: ethers.parseEther("3") });
    await tx1.wait();
    const inv1BalAfter = await ethers.provider.getBalance(investor1.address);
    console.log(`     Investor 1 funding gas cost: ${ethers.formatEther((inv1BalBefore - inv1BalAfter) - ethers.parseEther("3"))} ETH`);
    
    console.log(`   Investor 2 sending 7 ETH...`);
    await investor2.sendTransaction({ to: escrowAddress, value: ethers.parseEther("7") });

    console.log(`\n  2. CLOSING FUNDING`);
    console.log(`   Developer locking vault and starting milestones...`);
    await escrow.connect(developer).closeFundingAndStart();

    console.log(`\n  3. CLAIMING TOKENS`);
    console.log(`   Investors pulling their equity from the Escrow...`);
    await escrow.connect(investor1).claimTokens();
    await escrow.connect(investor2).claimTokens();

    console.log(`\n  4. VERIFYING PROPORTIONAL MATH`);
    const bal1 = await token.balanceOf(investor1.address);
    const bal2 = await token.balanceOf(investor2.address);

    console.log(`   Investor 1 Token Balance: ${ethers.formatEther(bal1)} ACME`);
    console.log(`   Investor 2 Token Balance: ${ethers.formatEther(bal2)} ACME`);
    console.log(`   Expected Split: 300,000 / 700,000`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
