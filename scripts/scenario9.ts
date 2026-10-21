import { network } from "hardhat";

async function main() {
  const { ethers } = await network.create();
  const [dev, inv, treasury] = await ethers.getSigners();

  console.log("🚀 SCENARIO 9: FAILED CROWDFUND (SOFT-CAP MISSED)");
  const Factory = await ethers.getContractFactory("ForgeCapitaFactory");
  const factory = await Factory.deploy(treasury.address);

  const tx = await factory.connect(dev).launchProject("SaaS", "SAS", 1000000n, ["M0"], [100n], ethers.parseEther("10"), 30n);
  const receipt = await tx.wait();
  const event = (await factory.queryFilter(factory.filters.ProjectLaunched(), receipt?.blockNumber))[0] as any;
  const escrow = await ethers.getContractAt("MilestoneEscrow", event.args.milestoneEscrow);

  console.log("\n💰 Investor funds 4 ETH (Goal is 10 ETH)...");
  await inv.sendTransaction({ to: escrow.target, value: ethers.parseEther("4") });

  console.log("⏳ Fast-forwarding 31 days (Deadline passed)...");
  await ethers.provider.send("evm_increaseTime", [31 * 24 * 60 * 60]);
  await ethers.provider.send("evm_mine", []);

  const balBefore = await ethers.provider.getBalance(inv.address);
  await escrow.connect(inv).refundFailedCrowdfund();
  const balAfter = await ethers.provider.getBalance(inv.address);

  console.log(`   - Refund Received ~ ${ethers.formatEther(balAfter - balBefore).substring(0, 4)} ETH (Expected: 4.0)`);
}
main().catch(console.error);