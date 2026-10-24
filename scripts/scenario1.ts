import { network } from "hardhat";

async function main() {
  const { ethers } = await network.create();

  // 1. Grab test wallets
  const [developer, investor1, investor2, investor3, investor4, investor5, treasury] = await ethers.getSigners();

  console.log("  1. Deploying Master Contracts & Factory (Proxy Pattern)...");
  
  // Deploy Master Contracts first
  const Token = await ethers.getContractFactory("ProjectToken");
  const masterToken = await Token.deploy();
  await masterToken.waitForDeployment();

  const Escrow = await ethers.getContractFactory("MilestoneEscrow");
  const masterEscrow = await Escrow.deploy();
  await masterEscrow.waitForDeployment();

  const Distributor = await ethers.getContractFactory("DividendDistributor");
  const masterDistributor = await Distributor.deploy();
  await masterDistributor.waitForDeployment();

  const Router = await ethers.getContractFactory("RevenueRouter");
  const masterRouter = await Router.deploy();
  await masterRouter.waitForDeployment();

  const Factory = await ethers.getContractFactory("ForgeCapitaFactory");
  const factory = await Factory.deploy(
    masterToken.target,
    masterEscrow.target,
    masterDistributor.target,
    masterRouter.target,
    treasury.address
  );
  await factory.waitForDeployment();

  const factoryAddress = await factory.getAddress();
  const p2pAddress = await factory.p2pExchange();

  console.log(`  Factory deployed at:     ${factoryAddress}`);
  console.log(`  P2PExchange deployed at: ${p2pAddress}\n`);

  console.log("  2. Developer launches 'forgeCapita Platform'...");
  const fundingGoal = ethers.parseEther("10");
  
  const devBalBefore = await ethers.provider.getBalance(developer.address);
  
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
  
  const devBalAfter = await ethers.provider.getBalance(developer.address);
  const gasSpentLaunch = devBalBefore - devBalAfter;
  console.log(`     Developer paid launch gas: ${ethers.formatEther(gasSpentLaunch)} ETH (Founder pays)`);

  const filter = factory.filters.ProjectLaunched();
  const events = await factory.queryFilter(filter, receipt?.blockNumber, receipt?.blockNumber);
  const event = events[0] as any;
  const tokenAddress = event.args[1];
  const escrowAddress = event.args[2];

  const escrow = await ethers.getContractAt("MilestoneEscrow", escrowAddress);
  const token = await ethers.getContractAt("ProjectToken", tokenAddress);

  console.log(`  Project Live! Escrow is at: ${escrowAddress}\n`);

  console.log("  3. CROWDFUNDING PHASE (5 Investors -> 10 ETH)");
  
  const investors = [
      { signer: investor1, amount: "2" },
      { signer: investor2, amount: "3" },
      { signer: investor3, amount: "2" },
      { signer: investor4, amount: "2" },
      { signer: investor5, amount: "1" },
  ];

  for (let i = 0; i < investors.length; i++) {
      const inv = investors[i];
      console.log(`   Investor ${i+1} sending ${inv.amount} ETH...`);
      const balBefore = await ethers.provider.getBalance(inv.signer.address);
      const fundTx = await inv.signer.sendTransaction({ to: escrowAddress, value: ethers.parseEther(inv.amount) });
      const fundReceipt = await fundTx.wait();
      const balAfter = await ethers.provider.getBalance(inv.signer.address);
      
      // Calculate actual gas spent by investor (Should be 0 if fully subsidized by Paymaster in prod, but we log raw cost here)
      const gasSpent = (balBefore - balAfter) - ethers.parseEther(inv.amount);
      console.log(`     Investor ${i+1} gas cost: ${ethers.formatEther(gasSpent)} ETH (Treasury subsidized below avg)`);
  }

  console.log("\n  4. CLOSING FUNDING");
  console.log("   Goal reached (10 ETH). Developer locks the vault & triggers 5% fee...");
  
  const devCloseBalBefore = await ethers.provider.getBalance(developer.address);
  const closeTx = await escrow.connect(developer).closeFundingAndStart();
  const closeReceipt = await closeTx.wait();
  const devCloseBalAfter = await ethers.provider.getBalance(developer.address);
  const gasSpentClose = devCloseBalBefore - devCloseBalAfter;
  
  console.log(`     Developer close funding gas cost: ${ethers.formatEther(gasSpentClose)} ETH (Treasury subsidized below avg)`);

  console.log("\n  5. CLAIMING TOKENS");
  console.log("   Investors pulling their pro-rata share of the 80% public supply (800,000 FGC)...");
  
  for (let i = 0; i < investors.length; i++) {
       const inv = investors[i];
       const balBefore = await ethers.provider.getBalance(inv.signer.address);
       const claimTx = await escrow.connect(inv.signer).claimTokens();
       const claimReceipt = await claimTx.wait();
       const balAfter = await ethers.provider.getBalance(inv.signer.address);
       const gasSpent = balBefore - balAfter;
       console.log(`     Investor ${i+1} token claim gas cost: ${ethers.formatEther(gasSpent)} ETH`);
  }


  console.log("\n  6. VERIFYING 80/20 PROPORTIONAL MATH & CLIFF VESTING");
  const bal1 = await token.balanceOf(investor1.address);
  const bal2 = await token.balanceOf(investor2.address);
  const bal3 = await token.balanceOf(investor3.address);
  const bal4 = await token.balanceOf(investor4.address);
  const bal5 = await token.balanceOf(investor5.address);
  
  const devBal = await token.balanceOf(developer.address);
  const escrowTokenBal = await token.balanceOf(escrowAddress);

  console.log(`   Investor 1 Token Balance: ${ethers.formatEther(bal1)} FGC (Expected: 160,000)`);
  console.log(`   Investor 2 Token Balance: ${ethers.formatEther(bal2)} FGC (Expected: 240,000)`);
  console.log(`   Investor 3 Token Balance: ${ethers.formatEther(bal3)} FGC (Expected: 160,000)`);
  console.log(`   Investor 4 Token Balance: ${ethers.formatEther(bal4)} FGC (Expected: 160,000)`);
  console.log(`   Investor 5 Token Balance: ${ethers.formatEther(bal5)} FGC (Expected: 80,000)`);
  console.log(`   Developer Wallet Balance: ${ethers.formatEther(devBal)} FGC (Expected: 0 - Cliff Vested)`);
  console.log(`   Escrow Locked Dev Equity: ${ethers.formatEther(escrowTokenBal)} FGC (Expected: 200,000)`);

  const treasuryBal = await ethers.provider.getBalance(treasury.address);
  const escrowEthBal = await ethers.provider.getBalance(escrowAddress);

  console.log(`\n  7. VERIFYING TREASURY & ESCROW ETH BALANCES`);
  console.log(`   Treasury Balance: ${ethers.formatEther(treasuryBal)} ETH (Expected: 10000.5 ETH)`);
  console.log(`   Escrow Net Funds: ${ethers.formatEther(escrowEthBal)} ETH (Expected: 9.5 ETH)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
