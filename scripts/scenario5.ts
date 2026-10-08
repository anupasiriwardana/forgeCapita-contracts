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
  
  const tokenAddress = event.args[1];
  const escrowAddress = event.args[2];
  
  const escrow = await ethers.getContractAt("MilestoneEscrow", escrowAddress);
  const token = await ethers.getContractAt("ProjectToken", tokenAddress);

  console.log("💰 2. FUNDING SUCCESS (10 ETH)");
  await investor1.sendTransaction({ to: escrowAddress, value: ethers.parseEther("6") });
  await investor2.sendTransaction({ to: escrowAddress, value: ethers.parseEther("4") });
  await escrow.connect(developer).closeFundingAndStart();
  await escrow.connect(investor1).claimTokens();
  await escrow.connect(investor2).claimTokens();

  console.log("\n⏳ 3. SIMULATING ABANDONMENT (Fast-forwarding 91 days)...");
  // Hardhat time travel: Advance the blockchain by 91 days (in seconds)
  await ethers.provider.send("evm_increaseTime", [91 * 24 * 60 * 60]);
  await ethers.provider.send("evm_mine", []);
  
  console.log("   ✅ 90-day deadlock period has expired.");

  console.log("\n🚨 4. INVESTORS TRIGGER DEADLOCK REFUND");
  
  // The total raised was 10 ETH. 5% went to treasury. Net pool = 9.5 ETH.
  // Investor 1 holds 60% of the tokens, so they are entitled to 60% of 9.5 ETH (5.7 ETH).
  
  const inv1Tokens = await token.balanceOf(investor1.address);
  
  // Step A: Approve the Escrow to pull the tokens
  console.log("   Investor 1 surrendering 600,000 FGC tokens...");
  await token.connect(investor1).approve(escrowAddress, inv1Tokens);
  
  const balBefore = await ethers.provider.getBalance(investor1.address);
  
  // Step B: Execute the refund
  const refundTx = await escrow.connect(investor1).refundDeadProject();
  const refundReceipt = await refundTx.wait();
  
  const balAfter = await ethers.provider.getBalance(investor1.address);
  const gasSpent = refundReceipt!.gasUsed * refundReceipt!.gasPrice;
  const netRefund = balAfter - balBefore + gasSpent;

  const inv1TokensAfter = await token.balanceOf(investor1.address);

  console.log(`\n📊 5. VERIFYING REFUND MATH`);
  console.log(`   Investor 1 Tokens Remaining: ${ethers.formatEther(inv1TokensAfter)} FGC (Expected: 0.0)`);
  console.log(`   Investor 1 ETH Recovered: ${ethers.formatEther(netRefund)} ETH (Expected: 5.7)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});