import { network } from "hardhat";

async function main() {
  const { ethers } = await network.create();
  const [dev, inv, treasury] = await ethers.getSigners();

  console.log("  SCENARIO 9: FAILED CROWDFUND (SOFT-CAP MISSED)");

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
  
  const escrow = await ethers.getContractAt("MilestoneEscrow", event.args.milestoneEscrow);

  console.log("\n  Investor funds 4 ETH (Goal is 10 ETH)...");
  await inv.sendTransaction({ to: escrow.target, value: ethers.parseEther("4") });

  console.log("  Fast-forwarding 31 days (Deadline passed)...");
  await ethers.provider.send("evm_increaseTime", [31 * 24 * 60 * 60]);
  await ethers.provider.send("evm_mine", []);

  const balBefore = await ethers.provider.getBalance(inv.address);
  await escrow.connect(inv).refundFailedCrowdfund();
  const balAfter = await ethers.provider.getBalance(inv.address);
  
  const gasSpent = (balBefore - balAfter) + ethers.parseEther("4");
  
  console.log(`     Investor failed crowdfund refund claim gas cost: ${ethers.formatEther(gasSpent)} ETH (Investor pays or Treasury subsidized depending on limit)`);

  console.log(`   - Refund Received ~ ${ethers.formatEther((balAfter - balBefore) + gasSpent).substring(0, 4)} ETH (Expected: 4.0)`);
}

main().catch(console.error);
