import { network } from "hardhat";

async function main() {
  const { ethers } = await network.create();

  // 1. Grab test wallets
  const [developer, investor1, investor2, treasury] = await ethers.getSigners();

  console.log("==========================================================");
  console.log("🚀 SCENARIO 3: FULL ROADMAP EXECUTION & CLIFF VESTING");
  console.log("==========================================================\n");

  console.log("🛠️  1. Deploying Factory & Launching Project...");
  const Factory = await ethers.getContractFactory("ForgeCapitaFactory");
  const factory = await Factory.deploy(treasury.address);
  await factory.waitForDeployment();

  // Launching with 3 Milestones (40% / 30% / 30%)
  const fundingGoal = ethers.parseEther("10");
  const tx = await factory.connect(developer).launchProject(
    "Acme SaaS", "ACME", 1000000n,
    ["M0: MVP Build", "M1: Beta Release", "M2: Mainnet V1"],
    [40n, 30n, 30n],
    fundingGoal,
    30n
  );

  const receipt = await tx.wait();
  const filter = factory.filters.ProjectLaunched();
  const events = await factory.queryFilter(filter, receipt?.blockNumber, receipt?.blockNumber);
  const event = events[0] as any;

  const token = await ethers.getContractAt("ProjectToken", event.args.projectToken);
  const escrow = await ethers.getContractAt("MilestoneEscrow", event.args.milestoneEscrow);
  const distributor = await ethers.getContractAt("DividendDistributor", event.args.dividendDistributor);

  console.log("💰 2. CROWDFUNDING PHASE (10 ETH Goal)");
  await investor1.sendTransaction({ to: escrow.target, value: ethers.parseEther("5") });
  await investor2.sendTransaction({ to: escrow.target, value: ethers.parseEther("5") });

  console.log("🔒 3. CLOSING FUNDING, CLAIMING & STAKING TOKENS");
  await escrow.connect(developer).closeFundingAndStart();

  await escrow.connect(investor1).claimTokens();
  await escrow.connect(investor2).claimTokens();

  // Investors must stake to activate voting power
  const inv1Bal = await token.balanceOf(investor1.address);
  const inv2Bal = await token.balanceOf(investor2.address);

  await token.connect(investor1).approve(distributor.target, inv1Bal);
  await distributor.connect(investor1).stake(inv1Bal);

  await token.connect(investor2).approve(distributor.target, inv2Bal);
  await distributor.connect(investor2).stake(inv2Bal);

  console.log("   - Net Funds available for milestones: 9.5 ETH (after 5% platform fee)\n");

  // =========================================================
  // MILESTONE 0 (40% Unlock)
  // =========================================================
  console.log("🟢 4. EXECUTING MILESTONE 0 (40%)");
  await escrow.connect(developer).startMilestone(0);

  // Investor 1 holds 50% of the public supply. We need >50% for Fast-Track, so both must vote.
  await escrow.connect(investor1).vote(true);
  await escrow.connect(investor2).vote(true);

  await escrow.connect(developer).executeMilestone();
  let devTokens = await token.balanceOf(developer.address);
  let devEth = await ethers.provider.getBalance(developer.address);

  console.log(`   - M0 Passed! Developer received : ${ethers.formatEther(devEth)}, expected: 1000 + 3.8 ETH (40% of 9.5 ETH)`);
  console.log(`   - Developer Token Balance: ${ethers.formatEther(devTokens)} ACME (Still Locked)\n`);

  // =========================================================
  // MILESTONE 1 (30% Unlock)
  // =========================================================
  console.log("🟡 5. EXECUTING MILESTONE 1 (30%)");
  await escrow.connect(developer).startMilestone(1);

  await escrow.connect(investor1).vote(true);
  await escrow.connect(investor2).vote(true);

  await escrow.connect(developer).executeMilestone();
  devTokens = await token.balanceOf(developer.address);

  console.log(`   - M1 Passed! Developer received 2.85 ETH (30% of 9.5 ETH)`);
  console.log(`   - Developer Token Balance: ${ethers.formatEther(devTokens)} ACME (Still Locked)\n`);

  // =========================================================
  // MILESTONE 2 (30% Unlock) - FINAL MILESTONE
  // =========================================================
  console.log("🔴 6. EXECUTING MILESTONE 2 (30% & CLIFF VEST UNLOCK)");
  await escrow.connect(developer).startMilestone(2);

  await escrow.connect(investor1).vote(true);
  await escrow.connect(investor2).vote(true);

  await escrow.connect(developer).executeMilestone();
  devTokens = await token.balanceOf(developer.address);
  const finalEscrowEth = await ethers.provider.getBalance(escrow.target);

  console.log(`   - M2 Passed! Developer received 2.85 ETH (Final 30% of 9.5 ETH)`);
  console.log(`   - Escrow Remaining ETH: ${ethers.formatEther(finalEscrowEth)} ETH`);
  console.log(`   - Developer Token Balance: ${ethers.formatEther(devTokens)} ACME`);

  if (devTokens === ethers.parseEther("200000") && finalEscrowEth === 0n) {
    console.log("\n🎯 SCENARIO 3 PASSED: Full roadmap executed, ETH drained, and cliff-vested tokens successfully delivered to the founder!");
  } else {
    console.error("\n❌ SCENARIO 3 FAILED: Incorrect final payouts.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});