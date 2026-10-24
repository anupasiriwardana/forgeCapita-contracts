import { network } from "hardhat";

async function main() {
  const { ethers } = await network.create();

  // 1. Grab test wallets
  const [developer, investor1, investor2, treasury] = await ethers.getSigners();

  console.log("==========================================================");
  console.log("  SCENARIO 2: STAKED GOVERNANCE & FAST-TRACK EXECUTION");
  console.log("==========================================================\n");

  console.log("   1. Deploying Master Contracts & Factory...");
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

  console.log("  2. CROWDFUNDING PHASE (10 ETH Goal)");
  await investor1.sendTransaction({ to: escrowAddress, value: ethers.parseEther("6") });
  await investor2.sendTransaction({ to: escrowAddress, value: ethers.parseEther("4") });
  console.log("   - Funding complete. Investor 1 (6 ETH) & Investor 2 (4 ETH).");

  console.log("\n  3. CLOSING FUNDING & CLAIMING TOKENS");
  await escrow.connect(developer).closeFundingAndStart();
  await escrow.connect(investor1).claimTokens();
  await escrow.connect(investor2).claimTokens();

  const inv1Bal = await token.balanceOf(investor1.address);
  console.log(`   - Investor 1 claimed: ${ethers.formatEther(inv1Bal)} ACME (60% of public supply)`);

  console.log("\n   4. STAKING TOKENS FOR GOVERNANCE");
  console.log("   - Investors must stake tokens to activate voting weight...");
  
  await token.connect(investor1).approve(distributorAddress, inv1Bal);
  
  const stakeBalBefore1 = await ethers.provider.getBalance(investor1.address);
  const stakeTx1 = await distributor.connect(investor1).stake(inv1Bal);
  const stakeReceipt1 = await stakeTx1.wait();
  const stakeBalAfter1 = await ethers.provider.getBalance(investor1.address);
  console.log(`     Investor 1 stake gas cost: ${ethers.formatEther(stakeBalBefore1 - stakeBalAfter1)} ETH`);

  const inv2Bal = await token.balanceOf(investor2.address);
  await token.connect(investor2).approve(distributorAddress, inv2Bal);
  await distributor.connect(investor2).stake(inv2Bal);

  const stakedWeight1 = await distributor.stakedBalance(investor1.address);
  console.log(`   - Investor 1 Staked Voting Power: ${ethers.formatEther(stakedWeight1)}`);

  console.log("\n   5. STARTING MILESTONE 0 & VOTING");
  
  const devStartBalBefore = await ethers.provider.getBalance(developer.address);
  const startTx = await escrow.connect(developer).startMilestone(0);
  const startReceipt = await startTx.wait();
  const devStartBalAfter = await ethers.provider.getBalance(developer.address);
  console.log(`     Developer start milestone gas cost: ${ethers.formatEther(devStartBalBefore - devStartBalAfter)} ETH (Treasury subsidized below avg)`);
  
  console.log("   - Milestone 0 Opened by Developer.");

  console.log("   - Investor 1 (Majority Holder) votes YES...");
  
  const invVoteBalBefore = await ethers.provider.getBalance(investor1.address);
  const voteTx = await escrow.connect(investor1).vote(true);
  const voteReceipt = await voteTx.wait();
  const invVoteBalAfter = await ethers.provider.getBalance(investor1.address);
  console.log(`     Investor 1 vote gas cost: ${ethers.formatEther(invVoteBalBefore - invVoteBalAfter)} ETH (Treasury subsidized below avg)`);

  console.log("\n  6. EXECUTING FAST-TRACK MILESTONE");
  const escrowEthBefore = await ethers.provider.getBalance(escrowAddress);
  
  const devExecBalBefore = await ethers.provider.getBalance(developer.address);
  const execTx = await escrow.connect(developer).executeMilestone();
  const execReceipt = await execTx.wait();
  const devExecBalAfter = await ethers.provider.getBalance(developer.address);
  // Calculate gas spent (Founder pays for execution)
  const executionCostRaw = (devExecBalBefore - devExecBalAfter); 

  const execFilter = escrow.filters.MilestoneExecuted();
  const execEvents = await escrow.queryFilter(execFilter, execReceipt?.blockNumber, execReceipt?.blockNumber);
  const execEvent = execEvents[0] as any;
  const ethReleased = execEvent.args.amountReleased;
  const tokensVested = execEvent.args.tokensVested;

  const escrowEthAfter = await ethers.provider.getBalance(escrowAddress);
  const devTokenBal = await token.balanceOf(developer.address);

  // We need to account for the ethReleased that was deposited into the developer's wallet during execution
  const gasSpentExec = executionCostRaw + ethReleased; 

  console.log(`     Developer execute milestone gas cost: ${ethers.formatEther(gasSpentExec)} ETH (Treasury subsidized below avg)`);

  console.log(`     Milestone 0 Executed Successfully!`);
  console.log(`   - Total Net Escrow Funds: ${ethers.formatEther(escrowEthBefore)} ETH`);
  console.log(`   - Developer ETH Payout (50%): ${ethers.formatEther(ethReleased)} ETH`);
  console.log(`   - Escrow Remaining ETH:   ${ethers.formatEther(escrowEthAfter)} ETH`);

  console.log(`\n  7. VERIFYING CLIFF VESTING`);
  console.log(`   - Tokens Vested this round: ${ethers.formatEther(tokensVested)} ACME`);
  console.log(`   - Developer Wallet Balance: ${ethers.formatEther(devTokenBal)} ACME`);

  if (devTokenBal === 0n && ethReleased === ethers.parseEther("4.75")) {
    console.log("\n  SCENARIO 2 PASSED: Fast-track majority execution and cliff-vesting confirmed!");
  } else {
    console.error("\n  SCENARIO 2 FAILED: Incorrect payouts.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
