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

  console.log("💰 2. FUNDING SUCCESS & CLOSING");
  await investor1.sendTransaction({ to: escrowAddress, value: ethers.parseEther("6") });
  await investor2.sendTransaction({ to: escrowAddress, value: ethers.parseEther("4") });
  await escrow.connect(developer).closeFundingAndStart();

  console.log("\n🚨 3. EXPLOIT ATTEMPT: DOUBLE TOKEN CLAIM");
  await escrow.connect(investor1).claimTokens();
  console.log("   ✅ First claim successful.");
  
  try {
    await escrow.connect(investor1).claimTokens();
    console.log("   ❌ ERROR: Second claim succeeded when it should have failed!");
  } catch (error: any) {
    console.log("   🛡️  Contract Protected! Revert Reason: " + 
      (error.message.includes("Tokens already claimed") ? '"Tokens already claimed"' : error.message));
  }

  console.log("\n🚨 4. EXPLOIT ATTEMPT: DOUBLE VOTING");
  await escrow.connect(investor1).vote(true);
  console.log("   ✅ First vote successful.");
  
  try {
    await escrow.connect(investor1).vote(true);
    console.log("   ❌ ERROR: Second vote succeeded when it should have failed!");
  } catch (error: any) {
    console.log("   🛡️  Contract Protected! Revert Reason: " + 
      (error.message.includes("Already voted") ? '"Already voted"' : error.message));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});