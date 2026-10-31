import { network } from "hardhat";

async function main() {
  const { ethers } = await network.create();
  const [dev, inv1, inv2, treasury] = await ethers.getSigners();

  console.log("  SCENARIO 8: 28-DAY QUORUM FALLBACK EXECUTION");

  const Token = await ethers.getContractFactory("ProjectToken");
  const masterToken = await Token.deploy();
  const Escrow = await ethers.getContractFactory("MilestoneEscrow");
  const masterEscrow = await Escrow.deploy();
  const Distributor = await ethers.getContractFactory("DividendDistributor");
  const masterDistributor = await Distributor.deploy();
  const Router = await ethers.getContractFactory("RevenueRouter");
  const masterRouter = await Router.deploy();

  const Registry = await ethers.getContractFactory("ForgeCapitaRegistry");
  const registry = await Registry.deploy(treasury.address);

  const Factory = await ethers.getContractFactory("ForgeCapitaFactory");
  const factory = await Factory.deploy(masterToken.target, masterEscrow.target, masterDistributor.target, masterRouter.target, registry.target);

  const tx = await factory.connect(dev).launchProject("SaaS", "SAS", 1000000n, ["M0"], [100n], ethers.parseEther("10"), 30n);
  const receipt = await tx.wait();
  const event = (await factory.queryFilter(factory.filters.ProjectLaunched(), receipt?.blockNumber))[0] as any;
  
  const token = await ethers.getContractAt("ProjectToken", event.args.projectToken);
  const escrow = await ethers.getContractAt("MilestoneEscrow", event.args.milestoneEscrow);
  const distributor = await ethers.getContractAt("DividendDistributor", event.args.dividendDistributor);

  await inv1.sendTransaction({ to: escrow.target, value: ethers.parseEther("3") });
  await inv2.sendTransaction({ to: escrow.target, value: ethers.parseEther("7") });

  await escrow.connect(dev).closeFundingAndStart();
  await escrow.connect(inv1).claimTokens();
  await token.connect(inv1).approve(distributor.target, ethers.parseEther("240000"));
  await distributor.connect(inv1).stake(ethers.parseEther("240000")); 

  console.log("\n  Inv 1 votes YES (30% of total public supply). Inv 2 abstains.");
  await escrow.connect(dev).startMilestone(0);
  await escrow.connect(inv1).vote(true);

  const chainId = (await ethers.provider.getNetwork()).chainId;
  const msgHash = ethers.solidityPackedKeccak256(["address", "uint256", "uint256", "uint256"], [escrow.target, 0, chainId, 0n]);
  const sig = await treasury.signMessage(ethers.getBytes(msgHash));

  console.log("  Attempting execution immediately (Should Fail)...");
  try {
    await escrow.connect(dev).executeMilestone(0n, sig);
    console.log("  ERROR: Milestone executed prematurely!");
  } catch (e: any) {
    console.log(`     Execution Reverted properly: ${e.message.includes("conditions not met")}`);
  }

  console.log("\n  Fast-forwarding 29 days...");
  await ethers.provider.send("evm_increaseTime", [29 * 24 * 60 * 60]);
  await ethers.provider.send("evm_mine", []);

  console.log("  Attempting execution again...");
  await escrow.connect(dev).executeMilestone(0n, sig);
  const devBal = await ethers.provider.getBalance(dev.address);
  console.log(`     Milestone Executed via Quorum! Dev balance updated.`);
}

main().catch(console.error);
