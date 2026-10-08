import { network } from "hardhat";

async function main() {
  const { ethers } = await network.create();
  const [developer, investor1, investor2, treasury] = await ethers.getSigners();

  console.log("🚀 1. Deploying Factory & Launching Project...");
  const Factory = await ethers.getContractFactory("ForgeCapitaFactory");
  const factory = await Factory.deploy(treasury.address);
  await factory.waitForDeployment();
  
  // Launching a 3-stage project (40 / 30 / 30)
  const tx = await factory.connect(developer).launchProject(
      "forgeCapita Equity", "FGC", 1000000n, ["Design", "Beta", "Mainnet"], [40, 30, 30], ethers.parseEther("10"), 30
  );
  const receipt = await tx.wait();
  const events = await factory.queryFilter(factory.filters.ProjectLaunched(), receipt?.blockNumber, receipt?.blockNumber);
  const event = events[0] as any; 
  
  const tokenAddress = event.args[1];
  const escrowAddress = event.args[2];
  
  const escrow = await ethers.getContractAt("MilestoneEscrow", escrowAddress);
  const token = await ethers.getContractAt("ProjectToken", tokenAddress);

  console.log("💰 2. FUNDING SUCCESS & CLAIMING TOKENS");
  await investor1.sendTransaction({ to: escrowAddress, value: ethers.parseEther("6") });
  await investor2.sendTransaction({ to: escrowAddress, value: ethers.parseEther("4") });
  
  await escrow.connect(developer).closeFundingAndStart();
  await escrow.connect(investor1).claimTokens();
  await escrow.connect(investor2).claimTokens();

  console.log("\n✅ 3. EXECUTING MILESTONE 0 (40%)");
  await escrow.connect(investor1).vote(true);
  await escrow.connect(developer).executeMilestone();
  
  const escrowBalAfterM0 = await ethers.provider.getBalance(escrowAddress);
  // Net pool = 9.5 ETH. Milestone 0 pays out 40% (3.8 ETH). Remaining = 5.7 ETH.
  console.log(`   Escrow Balance Remaining: ${ethers.formatEther(escrowBalAfterM0)} ETH`);

  console.log("\n⏳ 4. REQUESTING MILESTONE 1 & SIMULATING ABANDONMENT");
  await escrow.connect(developer).requestNextMilestone();
  console.log("   Developer requests Milestone 1. Investors refuse to vote Yes.");
  
  // Fast-forward 91 days
  await ethers.provider.send("evm_increaseTime", [91 * 24 * 60 * 60]);
  await ethers.provider.send("evm_mine", []);
  console.log("   ✅ 90-day deadlock period has expired.");

  console.log("\n🚨 5. INVESTORS PULL REMAINING FUNDS");
  
  const inv1Tokens = await token.balanceOf(investor1.address);
  await token.connect(investor1).approve(escrowAddress, inv1Tokens);
  
  const balBefore = await ethers.provider.getBalance(investor1.address);
  
  const refundTx = await escrow.connect(investor1).refundDeadProject();
  const refundReceipt = await refundTx.wait();
  
  const balAfter = await ethers.provider.getBalance(investor1.address);
  const gasSpent = refundReceipt!.gasUsed * refundReceipt!.gasPrice;
  const netRefund = balAfter - balBefore + gasSpent;

  console.log(`\n📊 6. VERIFYING MID-PROJECT REFUND MATH`);
  // Investor 1 owns 60% of the tokens. They should receive 60% of the remaining 5.7 ETH pool (3.42 ETH).
  console.log(`   Investor 1 ETH Recovered: ${ethers.formatEther(netRefund)} ETH (Expected: 3.42)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});