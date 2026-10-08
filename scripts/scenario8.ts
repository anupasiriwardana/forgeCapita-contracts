import { network } from "hardhat";

async function main() {
  const { ethers } = await network.create();
  const [developer, investor1, investor2, treasury] = await ethers.getSigners();

  console.log("🚀 1. Deploying Factory & Launching Project...");
  const Factory = await ethers.getContractFactory("ForgeCapitaFactory");
  const factory = await Factory.deploy(treasury.address);
  await factory.waitForDeployment();
  
  const tx = await factory.connect(developer).launchProject(
      "forgeCapita Equity", "FGC", 1000000n, ["MVP Build"], [100], ethers.parseEther("10"), 30
  );
  const receipt = await tx.wait();
  const events = await factory.queryFilter(factory.filters.ProjectLaunched(), receipt?.blockNumber, receipt?.blockNumber);
  const event = events[0] as any; 
  
  const escrowAddress = event.args[2];
  const escrow = await ethers.getContractAt("MilestoneEscrow", escrowAddress);

  console.log("💰 2. FUNDING SUCCESS & CLAIMING TOKENS");
  await investor1.sendTransaction({ to: escrowAddress, value: ethers.parseEther("6") }); // 60% Power
  await investor2.sendTransaction({ to: escrowAddress, value: ethers.parseEther("4") }); // 40% Power
  
  await escrow.connect(developer).closeFundingAndStart();
  await escrow.connect(investor1).claimTokens();
  await escrow.connect(investor2).claimTokens();

  console.log("\n🗳️ 3. MINORITY VOTE CAST");
  // Investor 2 (who only has 40% voting power) votes Yes.
  await escrow.connect(investor2).vote(true);
  
  const milestone = await escrow.milestones(0);
  console.log(`   Current Yes Votes: ${ethers.formatEther(milestone.yesVotes)} FGC / 1,000,000 FGC`);
  console.log(`   Required Threshold: > 500,000 FGC`);

  console.log("\n🚨 4. DEVELOPER ATTEMPTS TO EXECUTE MILESTONE");
  try {
    // Developer attempts to bypass the vote and execute
    await escrow.connect(developer).executeMilestone();
    console.log("   ❌ ERROR: Transaction succeeded when it should have failed!");
  } catch (error: any) {
    console.log("   ✅ Transaction correctly reverted!");
    // Extract the exact revert reason from the EVM error
    if (error.message.includes("Not enough Yes votes")) {
      console.log(`   EVM Revert Reason: "Not enough Yes votes"`);
    } else {
      console.log(error.message);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});