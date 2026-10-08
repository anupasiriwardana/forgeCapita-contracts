import { network } from "hardhat";

async function main() {
  const { ethers } = await network.create();
  const [developer, investor1, investor2, treasury] = await ethers.getSigners();

  console.log("🚀 1. Deploying Factory & Launching Project...");
  const Factory = await ethers.getContractFactory("ForgeCapitaFactory");
  const factory = await Factory.deploy(treasury.address);
  await factory.waitForDeployment();
  
  // Launching a project with a 10 ETH goal and a 30-day deadline
  const tx = await factory.connect(developer).launchProject(
      "forgeCapita Equity", "FGC", 1000000n, ["MVP Build"], [100], ethers.parseEther("10"), 30
  );
  const receipt = await tx.wait();
  const events = await factory.queryFilter(factory.filters.ProjectLaunched(), receipt?.blockNumber, receipt?.blockNumber);
  const event = events[0] as any; 
  
  const escrowAddress = event.args[2];
  const escrow = await ethers.getContractAt("MilestoneEscrow", escrowAddress);

  console.log("💰 2. CROWDFUNDING PHASE (Underfunded)");
  console.log("   Investor 1 sending 4 ETH...");
  await investor1.sendTransaction({ to: escrowAddress, value: ethers.parseEther("4") });
  
  console.log("   Investor 2 sending 3 ETH...");
  await investor2.sendTransaction({ to: escrowAddress, value: ethers.parseEther("3") });

  const currentBal = await ethers.provider.getBalance(escrowAddress);
  console.log(`   Total Raised: ${ethers.formatEther(currentBal)} ETH / 10.0 ETH Goal`);

  console.log("\n⏳ 3. SIMULATING DEADLINE FAILURE (Fast-forwarding 31 days)...");
  // Hardhat time travel: Advance the blockchain by 31 days
  await ethers.provider.send("evm_increaseTime", [31 * 24 * 60 * 60]);
  await ethers.provider.send("evm_mine", []);
  
  console.log("   ✅ 30-day funding deadline has expired.");

  console.log("\n🚨 4. INVESTORS CLAIM RAW REFUNDS");
  
  const balBefore1 = await ethers.provider.getBalance(investor1.address);
  const refundTx1 = await escrow.connect(investor1).refundFailedCrowdfund();
  const receipt1 = await refundTx1.wait();
  
  const balAfter1 = await ethers.provider.getBalance(investor1.address);
  const gasSpent1 = receipt1!.gasUsed * receipt1!.gasPrice;
  const netRefund1 = balAfter1 - balBefore1 + gasSpent1;

  console.log(`\n📊 5. VERIFYING SOFT-CAP REFUND MATH`);
  console.log(`   Investor 1 ETH Recovered: ${ethers.formatEther(netRefund1)} ETH (Expected: 4.0)`);
  
  const escrowBalAfter = await ethers.provider.getBalance(escrowAddress);
  console.log(`   Remaining Escrow Balance: ${ethers.formatEther(escrowBalAfter)} ETH (Expected: 3.0 from Investor 2's unclaimed funds)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});