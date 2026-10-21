import { network } from "hardhat";

async function main() {
  const { ethers } = await network.create();
  const [oldDev, newDev, treasury] = await ethers.getSigners();

  console.log("🚀 SCENARIO 11: DEVELOPER ROLE MIGRATION");
  const Factory = await ethers.getContractFactory("ForgeCapitaFactory");
  const factory = await Factory.deploy(treasury.address);
  const tx = await factory.connect(oldDev).launchProject("SaaS", "SAS", 1000000n, ["M0"], [100n], ethers.parseEther("10"), 30n);
  const receipt = await tx.wait();
  const event = (await factory.queryFilter(factory.filters.ProjectLaunched(), receipt?.blockNumber))[0] as any;
  const escrow = await ethers.getContractAt("MilestoneEscrow", event.args.milestoneEscrow);

  console.log("\n🔄 Old Developer proposes new Developer wallet...");
  await escrow.connect(oldDev).proposeNewDeveloper(newDev.address);

  let currentDev = await escrow.developer();
  console.log(`   - Active Developer is still: ${currentDev === oldDev.address ? "Old Dev" : "New Dev"}`);

  console.log("✅ New Developer accepts role...");
  await escrow.connect(newDev).acceptDeveloperRole();

  currentDev = await escrow.developer();
  console.log(`   - Active Developer is now:   ${currentDev === newDev.address ? "New Dev" : "Old Dev"}`);
}
main().catch(console.error);