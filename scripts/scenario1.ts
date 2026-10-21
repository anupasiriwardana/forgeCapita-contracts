import { network } from "hardhat";

async function main() {
  const { ethers } = await network.create();

  // 1. Grab 5 test wallets (Developer, 3 Investors, and Treasury)
  const [developer, investor1, investor2, investor3, treasury] = await ethers.getSigners();

  console.log("🚀 1. Deploying ForgeCapita Factory...");
  const Factory = await ethers.getContractFactory("ForgeCapitaFactory");

  // Pass the treasury wallet to the Factory (also auto-deploys P2PExchange)
  const factory = await Factory.deploy(treasury.address);
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  const p2pAddress = await factory.p2pExchange();

  console.log(`🏭 Factory deployed at:     ${factoryAddress}`);
  console.log(`💱 P2PExchange deployed at: ${p2pAddress}\n`);

  console.log("🚀 2. Developer launches 'forgeCapita Platform'...");
  const fundingGoal = ethers.parseEther("10");

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

  const filter = factory.filters.ProjectLaunched();
  const events = await factory.queryFilter(filter, receipt?.blockNumber, receipt?.blockNumber);
  const event = events[0] as any;

  const tokenAddress = event.args[1];
  const escrowAddress = event.args[2];

  const escrow = await ethers.getContractAt("MilestoneEscrow", escrowAddress);
  const token = await ethers.getContractAt("ProjectToken", tokenAddress);

  console.log(`✅ Project Live! Escrow is at: ${escrowAddress}\n`);

  console.log("💰 3. CROWDFUNDING PHASE (3 Investors -> 10 ETH)");
  console.log("   Investor 1 sending 2 ETH (20% of public raise)...");
  await investor1.sendTransaction({ to: escrowAddress, value: ethers.parseEther("2") });

  console.log("   Investor 2 sending 3 ETH (30% of public raise)...");
  await investor2.sendTransaction({ to: escrowAddress, value: ethers.parseEther("3") });

  console.log("   Investor 3 sending 5 ETH (50% of public raise)...");
  await investor3.sendTransaction({ to: escrowAddress, value: ethers.parseEther("5") });

  console.log("\n🔒 4. CLOSING FUNDING");
  console.log("   Goal reached (10 ETH). Developer locks the vault & triggers 5% fee...");
  await escrow.connect(developer).closeFundingAndStart();

  console.log("\n🎟️ 5. CLAIMING TOKENS");
  console.log("   Investors pulling their pro-rata share of the 80% public supply (800,000 FGC)...");
  await escrow.connect(investor1).claimTokens();
  await escrow.connect(investor2).claimTokens();
  await escrow.connect(investor3).claimTokens();

  console.log("\n📊 6. VERIFYING 80/20 PROPORTIONAL MATH & CLIFF VESTING");
  const bal1 = await token.balanceOf(investor1.address);
  const bal2 = await token.balanceOf(investor2.address);
  const bal3 = await token.balanceOf(investor3.address);
  const devBal = await token.balanceOf(developer.address);
  const escrowTokenBal = await token.balanceOf(escrowAddress);

  console.log(`   Investor 1 Token Balance: ${ethers.formatEther(bal1)} FGC (Expected: 160,000)`);
  console.log(`   Investor 2 Token Balance: ${ethers.formatEther(bal2)} FGC (Expected: 240,000)`);
  console.log(`   Investor 3 Token Balance: ${ethers.formatEther(bal3)} FGC (Expected: 400,000)`);
  console.log(`   Developer Wallet Balance: ${ethers.formatEther(devBal)} FGC (Expected: 0 - Cliff Vested)`);
  console.log(`   Escrow Locked Dev Equity: ${ethers.formatEther(escrowTokenBal)} FGC (Expected: 200,000)`);

  // Verify Treasury received the 5% success fee (0.5 ETH) and Escrow holds 9.5 ETH
  const treasuryBal = await ethers.provider.getBalance(treasury.address);
  const escrowEthBal = await ethers.provider.getBalance(escrowAddress);

  console.log(`\n🏦 7. VERIFYING TREASURY & ESCROW ETH BALANCES`);
  console.log(`   Treasury Balance: ${ethers.formatEther(treasuryBal)} ETH (Expected: 10000.5 ETH)`);
  console.log(`   Escrow Net Funds: ${ethers.formatEther(escrowEthBal)} ETH (Expected: 9.5 ETH)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});