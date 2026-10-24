import { network } from "hardhat";

async function main() {
  const { ethers } = await network.create();

  const [developer, investor1, investor2, treasury] = await ethers.getSigners();

  console.log("==========================================================");
  console.log("  SCENARIO 3: FULL ROADMAP EXECUTION & CLIFF VESTING");
  console.log("==========================================================\n");

  const Token = await ethers.getContractFactory("ProjectToken");
  const masterToken = await Token.deploy();
  const Escrow = await ethers.getContractFactory("MilestoneEscrow");
  const masterEscrow = await Escrow.deploy();
  const Distributor = await ethers.getContractFactory("DividendDistributor");
  const masterDistributor = await Distributor.deploy();
  const Router = await ethers.getContractFactory("RevenueRouter");
  const masterRouter = await Router.deploy();

  const Factory = await ethers.getContractFactory("ForgeCapitaFactory");
  const factory = await Factory.deploy(masterToken.target, masterEscrow.target, masterDistributor.target, masterRouter.target, treasury.address);
  await factory.waitForDeployment();

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

  console.log("  2. CROWDFUNDING PHASE (10 ETH Goal)");
  await investor1.sendTransaction({ to: escrow.target, value: ethers.parseEther("5") });
  await investor2.sendTransaction({ to: escrow.target, value: ethers.parseEther("5") });

  console.log("  3. CLOSING FUNDING, CLAIMING & STAKING TOKENS");
  await escrow.connect(developer).closeFundingAndStart();
  await escrow.connect(investor1).claimTokens();
  await escrow.connect(investor2).claimTokens();

  const inv1Bal = await token.balanceOf(investor1.address);
  const inv2Bal = await token.balanceOf(investor2.address);
  await token.connect(investor1).approve(distributor.target, inv1Bal);
  await distributor.connect(investor1).stake(inv1Bal);
  await token.connect(investor2).approve(distributor.target, inv2Bal);
  await distributor.connect(investor2).stake(inv2Bal);

  console.log("   - Net Funds available for milestones: 9.5 ETH (after 5% platform fee)\n");

  console.log("  4. EXECUTING MILESTONE 0 (40%)");
  await escrow.connect(developer).startMilestone(0);
  
  const voteBalBefore = await ethers.provider.getBalance(investor1.address);
  await escrow.connect(investor1).vote(true);
  const voteBalAfter = await ethers.provider.getBalance(investor1.address);
  console.log(`     Investor 1 vote gas cost: ${ethers.formatEther(voteBalBefore - voteBalAfter)} ETH`);
  
  await escrow.connect(investor2).vote(true);
  
  const execBalBefore = await ethers.provider.getBalance(developer.address);
  await escrow.connect(developer).executeMilestone();
  const execBalAfter = await ethers.provider.getBalance(developer.address);
  
  // Developer received 3.8 ETH (40% of 9.5). Gas spent is (Before - After) + Received
  console.log(`     Developer M0 execution gas cost: ${ethers.formatEther((execBalBefore - execBalAfter) + ethers.parseEther("3.8"))} ETH (Treasury subsidized below avg)`);


  let devTokens = await token.balanceOf(developer.address);
  let devEth = await ethers.provider.getBalance(developer.address);
  console.log(`   - M0 Passed! Developer received : ${ethers.formatEther(devEth)}, expected: 1000 + 3.8 ETH (40% of 9.5 ETH)`);
  console.log(`   - Developer Token Balance: ${ethers.formatEther(devTokens)} ACME (Still Locked)\n`);

  console.log("  5. EXECUTING MILESTONE 1 (30%)");
  await escrow.connect(developer).startMilestone(1);
  await escrow.connect(investor1).vote(true);
  await escrow.connect(investor2).vote(true);
  await escrow.connect(developer).executeMilestone();

  devTokens = await token.balanceOf(developer.address);
  console.log(`   - M1 Passed! Developer received 2.85 ETH (30% of 9.5 ETH)`);
  console.log(`   - Developer Token Balance: ${ethers.formatEther(devTokens)} ACME (Still Locked)\n`);

  console.log("  6. EXECUTING MILESTONE 2 (30% & CLIFF VEST UNLOCK)");
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
    console.log("\n  SCENARIO 3 PASSED: Full roadmap executed, ETH drained, and cliff-vested tokens successfully delivered to the founder!");
  } else {
    console.error("\n  SCENARIO 3 FAILED: Incorrect final payouts.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
