import { network } from "hardhat";

async function main() {
  const { ethers } = await network.create();
  const [developer, investor1, investor2, treasury, cust1, cust2, cust3] = await ethers.getSigners();

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
  const distributorAddress = event.args[3];
  const routerAddress = event.args[4]; 
  
  const escrow = await ethers.getContractAt("MilestoneEscrow", escrowAddress);
  const router = await ethers.getContractAt("RevenueRouter", routerAddress);
  const distributor = await ethers.getContractAt("DividendDistributor", distributorAddress);
  const token = await ethers.getContractAt("ProjectToken", tokenAddress);

  console.log("💰 2. FUNDING & STAKING (Investor 1 gets 60% Equity)");
  await investor1.sendTransaction({ to: escrowAddress, value: ethers.parseEther("6") });
  await investor2.sendTransaction({ to: escrowAddress, value: ethers.parseEther("4") });
  await escrow.connect(developer).closeFundingAndStart();
  await escrow.connect(investor1).claimTokens();
  await escrow.connect(investor2).claimTokens();

  // Investor 1 stakes their 600,000 FGC tokens to activate yield
  const bal1 = await token.balanceOf(investor1.address);
  await token.connect(investor1).approve(distributorAddress, bal1);
  await distributor.connect(investor1).stake(bal1);
  console.log("   ✅ Investor 1 staked 600,000 FGC tokens.");

  // Investor 2 stakes their 400,000 FGC tokens to activate yield
  const bal2 = await token.balanceOf(investor2.address);
  await token.connect(investor2).approve(distributorAddress, bal2);
  await distributor.connect(investor2).stake(bal2);
  console.log("   ✅ Investor 2 staked 400,000 FGC tokens.");

  console.log("\n💳 3. SIMULATING MULTIPLE SAAS PAYMENTS (Total = 4.5 ETH)");
  console.log("   Customer 1 pays 1.0 ETH...");
  await router.connect(cust1).routePayment({ value: ethers.parseEther("1.0") });
  
  console.log("   Customer 2 pays 2.0 ETH...");
  await router.connect(cust2).routePayment({ value: ethers.parseEther("2.0") });
  
  console.log("   Customer 3 pays 1.5 ETH...");
  await router.connect(cust3).routePayment({ value: ethers.parseEther("1.5") });

  console.log("\n📊 4. VERIFYING LEDGER ACCUMULATION");
  // Total Revenue = 4.5 ETH. 
  // Treasury (1%) = 0.045 ETH. 
  // Developer (39%) = 1.755 ETH. 
  // Dividend Pool (60%) = 2.70 ETH.
  
  const pendingCreator = await router.creatorPendingFunds();
  const pendingTreasury = await router.treasuryPendingFunds();
  const distributorBal = await ethers.provider.getBalance(distributorAddress);

  console.log(`   Developer Pending: ${ethers.formatEther(pendingCreator)} ETH (Expected: 1.755)`);
  console.log(`   Treasury Pending: ${ethers.formatEther(pendingTreasury)} ETH (Expected: 0.045)`);
  console.log(`   Total Dividend Pool: ${ethers.formatEther(distributorBal)} ETH (Expected: 2.70)`);

  console.log("\n📥 5. EXECUTING PULL WITHDRAWALS");
  
  // Developer claims their accumulated 1.755 ETH
  await router.connect(developer).claimCreatorFunds();
  console.log("   ✅ Developer successfully claimed accumulated revenue.");

  // Investor 1 claims their yield. Since they hold 60% of the staked tokens, 
  // they should receive 60% of the 2.70 ETH dividend pool (1.62 ETH).
  const inv1BalBefore = await ethers.provider.getBalance(investor1.address);
  
  const claimTx = await distributor.connect(investor1).claimYield();
  const claimReceipt = await claimTx.wait();
  
  const inv1BalAfter = await ethers.provider.getBalance(investor1.address);
  const gasSpent = claimReceipt!.gasUsed * claimReceipt!.gasPrice;
  const netYieldGain = inv1BalAfter - inv1BalBefore + gasSpent;

  console.log(`   Investor 1 Yield Received: ${ethers.formatEther(netYieldGain)} ETH (Expected: 1.62)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});