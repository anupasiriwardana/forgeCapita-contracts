import { network } from "hardhat";

async function main() {
  const { ethers } = await network.create();
  const [developer, investor1, investor2, treasury] = await ethers.getSigners();

  console.log("🚀 1. Deploying Factory & Launching Project...");
  const Factory = await ethers.getContractFactory("ForgeCapitaFactory");
  const factory = await Factory.deploy(treasury.address);
  await factory.waitForDeployment();
  
  // Launching a project with 3 milestones
  const tx = await factory.connect(developer).launchProject(
      "forgeCapita Equity", 
      "FGC", 
      1000000n, 
      ["Design & MVP", "Beta Launch", "V1.0 Mainnet"],
      [40, 30, 30], // Must equal 100
      ethers.parseEther("10"), 
      30
  );
  const receipt = await tx.wait();
  
  const filter = factory.filters.ProjectLaunched();
  const events = await factory.queryFilter(filter, receipt?.blockNumber, receipt?.blockNumber);
  const event = events[0] as any; 
  
  const escrowAddress = event.args[2];
  const escrow = await ethers.getContractAt("MilestoneEscrow", escrowAddress);

  console.log("💰 2. CROWDFUNDING PHASE (10 ETH Total)");
  await investor1.sendTransaction({ to: escrowAddress, value: ethers.parseEther("6") });
  await investor2.sendTransaction({ to: escrowAddress, value: ethers.parseEther("4") });

  console.log("🔒 3. CLOSING FUNDING (Platform takes 5% fee)");
  await escrow.connect(developer).closeFundingAndStart();
  
  await escrow.connect(investor1).claimTokens();
  await escrow.connect(investor2).claimTokens();

  // Net funds remaining in Escrow after 5% fee = 9.5 ETH
  console.log("\n🛤️ 4. EXECUTING FULL ROADMAP (9.5 ETH Net Pool)");

  // --- MILESTONE 0 (40%) ---
  console.log("\n   ▶ Milestone 0 (40% = 3.8 ETH)");
  await escrow.connect(investor1).vote(true);
  await escrow.connect(developer).executeMilestone();
  console.log("     ✅ Milestone 0 Executed.");

  // --- MILESTONE 1 (30%) ---
  console.log("\n   ▶ Milestone 1 (30% = 2.85 ETH)");
  // Developer must explicitly request the next stage
  await escrow.connect(developer).requestNextMilestone();
  await escrow.connect(investor1).vote(true);
  await escrow.connect(developer).executeMilestone();
  console.log("     ✅ Milestone 1 Executed.");

  // --- MILESTONE 2 (30%) ---
  console.log("\n   ▶ Milestone 2 (30% = 2.85 ETH)");
  await escrow.connect(developer).requestNextMilestone();
  await escrow.connect(investor1).vote(true);
  await escrow.connect(developer).executeMilestone();
  console.log("     ✅ Milestone 2 Executed.");

  console.log("\n🏆 5. FINAL VERIFICATION");
  const escrowBal = await ethers.provider.getBalance(escrowAddress);
  console.log(`   Remaining Escrow Balance: ${ethers.formatEther(escrowBal)} ETH (Expected: 0.0)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});