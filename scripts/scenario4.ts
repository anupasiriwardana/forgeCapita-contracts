import { network } from "hardhat";

async function main() {
  const { ethers } = await network.create();

  const [developer, investor1, investor2, treasury] = await ethers.getSigners();

  console.log("==========================================================");
  console.log("  SCENARIO 4: 120-DAY DEADLOCK & PRO-RATA REFUNDS");
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
    ["M0: MVP Build", "M1: Beta Release"], [50n, 50n],
    fundingGoal, 30n
  );
  const receipt = await tx.wait();

  const filter = factory.filters.ProjectLaunched();
  const events = await factory.queryFilter(filter, receipt?.blockNumber, receipt?.blockNumber);
  const event = events[0] as any;
  const token = await ethers.getContractAt("ProjectToken", event.args.projectToken);
  const escrow = await ethers.getContractAt("MilestoneEscrow", event.args.milestoneEscrow);
  const distributor = await ethers.getContractAt("DividendDistributor", event.args.dividendDistributor);

  console.log("  2. CROWDFUNDING PHASE (10 ETH Goal)");
  await investor1.sendTransaction({ to: escrow.target, value: ethers.parseEther("6") }); // 60%
  await investor2.sendTransaction({ to: escrow.target, value: ethers.parseEther("4") }); // 40%

  const escrowBalBefore = await ethers.provider.getBalance(escrow.target);
  console.log(`   - Raw Escrow Balance: ${ethers.formatEther(escrowBalBefore)} ETH (Expected: 10.0)`);

  console.log("\n  3. CLOSING FUNDING & DISTRIBUTING TOKENS");
  await escrow.connect(developer).closeFundingAndStart();

  const escrowBalAfterClose = await ethers.provider.getBalance(escrow.target);
  console.log(`   - Net Escrow Balance after 5% fee: ${ethers.formatEther(escrowBalAfterClose)} ETH (Expected: 9.5)`);

  await escrow.connect(investor1).claimTokens();
  await escrow.connect(investor2).claimTokens();

  const inv1Bal = await token.balanceOf(investor1.address);
  const inv2Bal = await token.balanceOf(investor2.address);

  console.log(`   - Investor 1 Claimed: ${ethers.formatEther(inv1Bal)} ACME (Expected: 480000.0)`);
  console.log(`   - Investor 2 Claimed: ${ethers.formatEther(inv2Bal)} ACME (Expected: 320000.0)`);

  console.log("\n   4. STAKING TOKENS (Activating Governance)");
  await token.connect(investor1).approve(distributor.target, inv1Bal);
  await distributor.connect(investor1).stake(inv1Bal);
  await token.connect(investor2).approve(distributor.target, inv2Bal);
  await distributor.connect(investor2).stake(inv2Bal);

  const totalStaked = await distributor.totalStaked();
  console.log(`   - Total Tokens Staked: ${ethers.formatEther(totalStaked)} ACME (Expected: 800000.0)`);

  console.log("\n  5. TRIGGERING DEADLOCK (Fast-forwarding > 120 days)");
  await escrow.connect(developer).startMilestone(0);

  await ethers.provider.send("evm_increaseTime", [121 * 24 * 60 * 60]);
  await ethers.provider.send("evm_mine", []);
  console.log("   - Blockchain time advanced by 121 days.");

  console.log("\n  6. UNSTAKING TO PREPARE FOR REFUND");
  await distributor.connect(investor1).withdraw(inv1Bal);
  await distributor.connect(investor2).withdraw(inv2Bal);

  const unstakedBal1 = await token.balanceOf(investor1.address);
  console.log(`   - Investor 1 Unstaked Balance: ${ethers.formatEther(unstakedBal1)} ACME (Expected: 480000.0)`);

  console.log("\n  7. CLAIMING DEADLOCK REFUNDS");
  
  await token.connect(investor1).approve(escrow.target, inv1Bal);
  
  const refundBalBefore1 = await ethers.provider.getBalance(investor1.address);
  const tx1 = await escrow.connect(investor1).refundDeadProject();
  const rcpt1 = await tx1.wait();
  const refundBalAfter1 = await ethers.provider.getBalance(investor1.address);

  const refundEvent1 = rcpt1?.logs.map((log: any) => {
    try { return escrow.interface.parseLog(log); } catch { return null; }
  }).find((parsed: any) => parsed?.name === "RefundClaimed");
  const actualRefund1 = refundEvent1?.args.amount;
  
  // Calculate true gas spent (Bal before - Bal after + Refund received)
  const gasSpentRefund = (refundBalBefore1 - refundBalAfter1) + actualRefund1;
  console.log(`     Investor 1 refund claim gas cost: ${ethers.formatEther(gasSpentRefund)} ETH (Investor pays or Treasury subsidized depending on limit)`);

  console.log(`   - Investor 1 Surrendered 60% of public supply.`);
  console.log(`   - Investor 1 Received: ${ethers.formatEther(actualRefund1)} ETH (Expected: 5.7)`);


  await token.connect(investor2).approve(escrow.target, inv2Bal);
  const tx2 = await escrow.connect(investor2).refundDeadProject();
  const rcpt2 = await tx2.wait();

  const refundEvent2 = rcpt2?.logs.map((log: any) => {
    try { return escrow.interface.parseLog(log); } catch { return null; }
  }).find((parsed: any) => parsed?.name === "RefundClaimed");
  const actualRefund2 = refundEvent2?.args.amount;

  console.log(`   - Investor 2 Surrendered 40% of public supply.`);
  console.log(`   - Investor 2 Received: ${ethers.formatEther(actualRefund2)} ETH (Expected: 3.8)`);

  console.log("\n  8. FINAL SYSTEM STATE");
  const finalEscrowEth = await ethers.provider.getBalance(escrow.target);
  const finalEscrowTokens = await token.balanceOf(escrow.target);

  console.log(`   - Escrow Remaining ETH: ${ethers.formatEther(finalEscrowEth)} ETH (Expected: 0.0)`);
  console.log(`   - Escrow Surrendered Tokens: ${ethers.formatEther(finalEscrowTokens)} ACME (Expected: 1000000.0)`);

  if (actualRefund1 === ethers.parseEther("5.7") && actualRefund2 === ethers.parseEther("3.8") && finalEscrowEth === 0n) {
    console.log("\n  SCENARIO 4 PASSED: Deadlock successfully liquidated and perfectly distributed!");
  } else {
    console.error("\n  SCENARIO 4 FAILED: Incorrect refund math.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
