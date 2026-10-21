import { network } from "hardhat";

async function main() {
  const { ethers } = await network.create();

  // 1. Grab test wallets
  const [developer, investor1, investor2, treasury] = await ethers.getSigners();

  console.log("==========================================================");
  console.log("🚀 SCENARIO 2: STAKED GOVERNANCE & FAST-TRACK EXECUTION");
  console.log("==========================================================\n");

  console.log("🛠️  1. Deploying Factory & Launching Project...");
  const Factory = await ethers.getContractFactory("ForgeCapitaFactory");
  const factory = await Factory.deploy(treasury.address);
  await factory.waitForDeployment();

  // Launching with 2 Milestones (50% / 50%)
  const fundingGoal = ethers.parseEther("10");
  const tx = await factory.connect(developer).launchProject(
    "Acme SaaS", "ACME", 1000000n,
    ["M0: MVP Build", "M1: Public Launch"], [50n, 50n],
    fundingGoal, 30n
  );

  const receipt = await tx.wait();
  const filter = factory.filters.ProjectLaunched();
  const events = await factory.queryFilter(filter, receipt?.blockNumber, receipt?.blockNumber);
  const event = events[0] as any;

  const tokenAddress = event.args.projectToken;
  const escrowAddress = event.args.milestoneEscrow;
  const distributorAddress = event.args.dividendDistributor;

  const escrow = await ethers.getContractAt("MilestoneEscrow", escrowAddress);
  const token = await ethers.getContractAt("ProjectToken", tokenAddress);
  const distributor = await ethers.getContractAt("DividendDistributor", distributorAddress);

  console.log(`   - Project Live! Escrow:      ${escrowAddress}`);
  console.log(`   - Dividend Distributor:      ${distributorAddress}\n`);

  console.log("💰 2. CROWDFUNDING PHASE (10 ETH Goal)");
  // Investor 1 provides 60% of the capital, giving them majority voting power
  await investor1.sendTransaction({ to: escrowAddress, value: ethers.parseEther("6") });
  await investor2.sendTransaction({ to: escrowAddress, value: ethers.parseEther("4") });
  console.log("   - Funding complete. Investor 1 (6 ETH) & Investor 2 (4 ETH).");

  console.log("\n🔒 3. CLOSING FUNDING & CLAIMING TOKENS");
  await escrow.connect(developer).closeFundingAndStart();
  await escrow.connect(investor1).claimTokens();
  await escrow.connect(investor2).claimTokens();

  const inv1Bal = await token.balanceOf(investor1.address);
  console.log(`   - Investor 1 claimed: ${ethers.formatEther(inv1Bal)} ACME (60% of public supply)`);

  console.log("\n🛡️  4. STAKING TOKENS FOR GOVERNANCE");
  console.log("   - Investors must stake tokens to activate voting weight...");

  // Approve and Stake for Investor 1
  await token.connect(investor1).approve(distributorAddress, inv1Bal);
  await distributor.connect(investor1).stake(inv1Bal);

  // Approve and Stake for Investor 2
  const inv2Bal = await token.balanceOf(investor2.address);
  await token.connect(investor2).approve(distributorAddress, inv2Bal);
  await distributor.connect(investor2).stake(inv2Bal);

  const stakedWeight1 = await distributor.stakedBalance(investor1.address);
  console.log(`   - Investor 1 Staked Voting Power: ${ethers.formatEther(stakedWeight1)}`);

  console.log("\n🗳️  5. STARTING MILESTONE 0 & VOTING");
  await escrow.connect(developer).startMilestone(0);
  console.log("   - Milestone 0 Opened by Developer.");

  // Investor 1 votes YES. Since they hold 60% of the public supply, Fast-Track >50% is instantly met.
  console.log("   - Investor 1 (Majority Holder) votes YES...");
  await escrow.connect(investor1).vote(true);

  console.log("\n⚡ 6. EXECUTING FAST-TRACK MILESTONE");
  const escrowEthBefore = await ethers.provider.getBalance(escrowAddress);

  // Developer executes the milestone
  const execTx = await escrow.connect(developer).executeMilestone();
  const execReceipt = await execTx.wait();

  // Extract MilestoneExecuted event to verify exact ETH and Token payouts
  const execFilter = escrow.filters.MilestoneExecuted();
  const execEvents = await escrow.queryFilter(execFilter, execReceipt?.blockNumber, execReceipt?.blockNumber);
  const execEvent = execEvents[0] as any;

  const ethReleased = execEvent.args.amountReleased;
  const tokensVested = execEvent.args.tokensVested;
  const escrowEthAfter = await ethers.provider.getBalance(escrowAddress);
  const devTokenBal = await token.balanceOf(developer.address);

  console.log(`   ✅ Milestone 0 Executed Successfully!`);
  console.log(`   - Total Net Escrow Funds: ${ethers.formatEther(escrowEthBefore)} ETH`);
  console.log(`   - Developer ETH Payout (50%): ${ethers.formatEther(ethReleased)} ETH`);
  console.log(`   - Escrow Remaining ETH:   ${ethers.formatEther(escrowEthAfter)} ETH`);

  console.log(`\n🧱 7. VERIFYING CLIFF VESTING`);
  console.log(`   - Tokens Vested this round: ${ethers.formatEther(tokensVested)} ACME`);
  console.log(`   - Developer Wallet Balance: ${ethers.formatEther(devTokenBal)} ACME`);

  if (devTokenBal === 0n && ethReleased === ethers.parseEther("4.75")) {
    console.log("\n🎯 SCENARIO 2 PASSED: Fast-track majority execution and cliff-vesting confirmed!");
  } else {
    console.error("\n❌ SCENARIO 2 FAILED: Incorrect payouts.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});