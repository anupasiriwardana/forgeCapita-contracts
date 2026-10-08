import { network } from "hardhat";

async function main() {
  const { ethers } = await network.create();

  // 1. Grab 4 test wallets (Added Treasury)
  const [developer, investor1, investor2, treasury] = await ethers.getSigners();

  console.log("🚀 1. Deploying ForgeCapita Factory...");
  const Factory = await ethers.getContractFactory("ForgeCapitaFactory");
  
  // Pass the treasury wallet to the Factory
  const factory = await Factory.deploy(treasury.address);
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  
  console.log(`🏭 Factory deployed at: ${factoryAddress}\n`);

  console.log("🚀 2. Developer launches 'forgeCapita Platform'...");
  const fundingGoal = ethers.parseEther("10"); 
  
  const tx = await factory.connect(developer).launchProject(
      "forgeCapita Equity", 
      "FGC", 
      1000000n, 
      ["MVP Build", "Public Launch"],
      [50, 50],
      fundingGoal,
      30 
  );
  
  const receipt = await tx.wait();
  
  const filter = factory.filters.ProjectLaunched();
  const events = await factory.queryFilter(filter, receipt?.blockNumber, receipt?.blockNumber);
  const event = events[0] as any; 
  
  const tokenAddress = event.args[1];
  const escrowAddress = event.args[2];
  
  const escrow = await ethers.getContractAt("MilestoneEscrow", escrowAddress);
  const token = await ethers.getContractAt("ProjectToken", tokenAddress);

  console.log(`✅ Project Live! Escrow is at: ${escrowAddress}\n`);

  console.log("💰 3. CROWDFUNDING PHASE");
  console.log("   Investor 1 sending 4 ETH...");
  await investor1.sendTransaction({ to: escrowAddress, value: ethers.parseEther("4") });
  
  console.log("   Investor 2 sending 6 ETH...");
  await investor2.sendTransaction({ to: escrowAddress, value: ethers.parseEther("6") });

  console.log("\n🔒 4. CLOSING FUNDING");
  console.log("   Goal reached (10 ETH). Developer locks the vault...");
  await escrow.connect(developer).closeFundingAndStart();

  console.log("\n🎟️ 5. CLAIMING TOKENS");
  console.log("   Investors pulling their equity from the Escrow...");
  await escrow.connect(investor1).claimTokens();
  await escrow.connect(investor2).claimTokens();

  console.log("\n📊 6. VERIFYING PROPORTIONAL MATH");
  const bal1 = await token.balanceOf(investor1.address);
  const bal2 = await token.balanceOf(investor2.address);
  
  console.log(`   Investor 1 Token Balance: ${ethers.formatEther(bal1)} FGC (Expected: 400,000)`);
  console.log(`   Investor 2 Token Balance: ${ethers.formatEther(bal2)} FGC (Expected: 600,000)`);
  
  // Verify Treasury received the 5% success fee (0.5 ETH)
  const treasuryBal = await ethers.provider.getBalance(treasury.address);
  // Default Hardhat accounts start with 10000 ETH. It should now have 10000.5 ETH.
  console.log(`   Treasury Balance: ${ethers.formatEther(treasuryBal)} ETH`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});