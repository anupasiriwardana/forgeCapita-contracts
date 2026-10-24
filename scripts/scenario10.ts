import { network } from "hardhat";

async function main() {
  const { ethers } = await network.create();
  const [dev, inv, treasury] = await ethers.getSigners();

  console.log("  SCENARIO 10: SYBIL VOTE-LOCK PROTECTION");

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

  const tx = await factory.connect(dev).launchProject("SaaS", "SAS", 1000000n, ["M0"], [100n], ethers.parseEther("1"), 30n);
  const receipt = await tx.wait();
  const event = (await factory.queryFilter(factory.filters.ProjectLaunched(), receipt?.blockNumber))[0] as any;
  
  const token = await ethers.getContractAt("ProjectToken", event.args.projectToken);
  const escrow = await ethers.getContractAt("MilestoneEscrow", event.args.milestoneEscrow);
  const distributor = await ethers.getContractAt("DividendDistributor", event.args.dividendDistributor);

  await inv.sendTransaction({ to: escrow.target, value: ethers.parseEther("1") });
  await escrow.connect(dev).closeFundingAndStart();
  await escrow.connect(inv).claimTokens();

  const invBal = await token.balanceOf(inv.address);
  await token.connect(inv).approve(distributor.target, invBal);
  await distributor.connect(inv).stake(invBal);

  console.log("\n  Investor votes on Milestone 0...");
  await escrow.connect(dev).startMilestone(0);
  await escrow.connect(inv).vote(true);

  console.log("  Attempting to unstake tokens while poll is open...");
  try {
    await distributor.connect(inv).withdraw(invBal);
    console.log("  ERROR: Tokens unstaked!");
  } catch (e: any) {
    console.log(`     Unstake Reverted correctly: ${e.message.includes("active milestone vote")}`);
  }
}

main().catch(console.error);
