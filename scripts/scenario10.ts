import { network } from "hardhat";

async function main() {
  const { ethers } = await network.create();
  const [developer, investor1, investor2, treasury, customer] = await ethers.getSigners();

  console.log("🚀 1. Deploying Ecosystem...");
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

  // Fund & Claim (Investor 1 gets 600k, Investor 2 gets 400k)
  await investor1.sendTransaction({ to: escrowAddress, value: ethers.parseEther("6") });
  await investor2.sendTransaction({ to: escrowAddress, value: ethers.parseEther("4") });
  await escrow.connect(developer).closeFundingAndStart();
  await escrow.connect(investor1).claimTokens();
  await escrow.connect(investor2).claimTokens();

  console.log("\n🏦 2. INVESTOR 1 STAKES EARLY");
  const bal1 = await token.balanceOf(investor1.address);
  await token.connect(investor1).approve(distributorAddress, bal1);
  await distributor.connect(investor1).stake(bal1);
  console.log("   ✅ Investor 1 staked 600,000 FGC.");

  console.log("\n💳 3. SAAS PAYMENT #1 ARRIVES (1 ETH)");
  // Dividend Pool gets 0.6 ETH. Investor 1 is the ONLY staker, so they own 100% of this 0.6 ETH.
  await router.connect(customer).routePayment({ value: ethers.parseEther("1.0") });

  console.log("\n🏦 4. INVESTOR 2 STAKES LATE");
  const bal2 = await token.balanceOf(investor2.address);
  await token.connect(investor2).approve(distributorAddress, bal2);
  await distributor.connect(investor2).stake(bal2);
  console.log("   ✅ Investor 2 staked 400,000 FGC.");

  console.log("\n💳 5. SAAS PAYMENT #2 ARRIVES (1 ETH)");
  // Dividend Pool gets another 0.6 ETH. 
  // Now both are staked. Inv 1 (60%) gets 0.36 ETH. Inv 2 (40%) gets 0.24 ETH.
  await router.connect(customer).routePayment({ value: ethers.parseEther("1.0") });

  console.log("\n📊 6. VERIFYING YIELD MATH PROTECTIONS");
  
  const getNetYield = async (investor: any) => {
      const balBefore = await ethers.provider.getBalance(investor.address);
      const tx = await distributor.connect(investor).claimYield();
      const receipt = await tx.wait();
      const balAfter = await ethers.provider.getBalance(investor.address);
      const gasSpent = receipt!.gasUsed * receipt!.gasPrice;
      return balAfter - balBefore + gasSpent;
  };

  const netYield1 = await getNetYield(investor1);
  const netYield2 = await getNetYield(investor2);

  // Expected Inv 1 = 0.6 (Payment 1) + 0.36 (Payment 2) = 0.96 ETH
  console.log(`   Investor 1 Yield: ${ethers.formatEther(netYield1)} ETH (Expected: 0.96)`);
  
  // Expected Inv 2 = 0.0 (Payment 1) + 0.24 (Payment 2) = 0.24 ETH
  console.log(`   Investor 2 Yield: ${ethers.formatEther(netYield2)} ETH (Expected: 0.24)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});