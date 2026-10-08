import { network } from "hardhat";

async function main() {
  const { ethers } = await network.create();
  
  // Grab 5 test wallets (Added Customer for the SaaS payment)
  const [developer, investor1, investor2, treasury, customer] = await ethers.getSigners();

  console.log("🚀 1. Deploying Factory & Launching Project...");
  const Factory = await ethers.getContractFactory("ForgeCapitaFactory");
  const factory = await Factory.deploy(treasury.address);
  await factory.waitForDeployment();
  
  const tx = await factory.connect(developer).launchProject(
      "forgeCapita Equity", 
      "FGC", 
      1000000n, 
      ["MVP Build", "Public Launch"],
      [50, 50], 
      ethers.parseEther("10"), 
      30
  );
  const receipt = await tx.wait();
  
  const filter = factory.filters.ProjectLaunched();
  const events = await factory.queryFilter(filter, receipt?.blockNumber, receipt?.blockNumber);
  const event = events[0] as any; 
  
  const tokenAddress = event.args[1];
  const escrowAddress = event.args[2];
  const distributorAddress = event.args[3];
  const routerAddress = event.args[4]; 
  
  const escrow = await ethers.getContractAt("MilestoneEscrow", escrowAddress);
  const router = await ethers.getContractAt("RevenueRouter", routerAddress);
  const distributor = await ethers.getContractAt("DividendDistributor", distributorAddress);
  const token = await ethers.getContractAt("ProjectToken", tokenAddress);

  console.log("💰 2. CROWDFUNDING PHASE (10 ETH Total)");
  await investor1.sendTransaction({ to: escrowAddress, value: ethers.parseEther("6") });
  await investor2.sendTransaction({ to: escrowAddress, value: ethers.parseEther("4") });

  console.log("🔒 3. CLOSING FUNDING & TAKING PLATFORM FEE");
  await escrow.connect(developer).closeFundingAndStart();

  console.log("🎟️ 4. CLAIMING TOKENS");
  await escrow.connect(investor1).claimTokens();
  await escrow.connect(investor2).claimTokens();

  console.log("🗳️ 5. VOTING & EXECUTING MILESTONE 0");
  await escrow.connect(investor1).vote(true);
  
  const devBalanceBefore = await ethers.provider.getBalance(developer.address);
  const execTx = await escrow.connect(developer).executeMilestone();
  const execReceipt = await execTx.wait();
  
  const gasSpent = execReceipt!.gasUsed * execReceipt!.gasPrice;
  const devBalanceAfter = await ethers.provider.getBalance(developer.address);
  const netGain = devBalanceAfter - devBalanceBefore + gasSpent;

  console.log(`   Developer received: ${ethers.formatEther(netGain)} ETH (Expected: 4.75 ETH)`);

  // ---------------------------------------------------------
  // NEW: STAKING TOKENS TO ACTIVATE YIELD
  // ---------------------------------------------------------
  console.log("\n🏦 7. INVESTOR 1 STAKES TOKENS");
  const bal1 = await token.balanceOf(investor1.address);
  
  // 1. Investor must approve the Distributor to handle their tokens
  await token.connect(investor1).approve(distributorAddress, bal1);
  // 2. Investor stakes the tokens
  await distributor.connect(investor1).stake(bal1);
  
  console.log(`   Investor 1 staked ${ethers.formatEther(bal1)} FGC`);

  // ---------------------------------------------------------
  // REVENUE ROUTER & PULL MECHANISM TEST
  // ---------------------------------------------------------
  console.log("\n💳 8. CUSTOMER PAYS FOR SAAS PRODUCT");
  console.log("   Customer sending 1 ETH to RevenueRouter...");
  
  await router.connect(customer).routePayment({ value: ethers.parseEther("1") });

  console.log("\n📊 9. VERIFYING 1 / 39 / 60 SPLIT & PULL MECHANISM");
  
  // The 60% is pushed to the Distributor immediately
  const distributorBal = await ethers.provider.getBalance(distributorAddress);
  console.log(`   Dividend Pool (Push): ${ethers.formatEther(distributorBal)} ETH (Expected: 0.6)`);

  // The 39% and 1% are held in the internal ledger (Pull)
  const pendingCreator = await router.creatorPendingFunds();
  const pendingTreasury = await router.treasuryPendingFunds();
  
  console.log(`   Developer Ledger (Pull): ${ethers.formatEther(pendingCreator)} ETH (Expected: 0.39)`);
  console.log(`   Treasury Ledger (Pull): ${ethers.formatEther(pendingTreasury)} ETH (Expected: 0.01)`);
  
  // Developer pulls their funds
  console.log("\n📥 10. DEVELOPER PULLS FUNDS");
  await router.connect(developer).claimCreatorFunds();
  const pendingCreatorAfter = await router.creatorPendingFunds();
  console.log(`   Developer Ledger After Claim: ${ethers.formatEther(pendingCreatorAfter)} ETH`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});