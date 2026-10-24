import { network } from "hardhat";

async function main() {
  const { ethers } = await network.create();
  const [dev, customer, treasury] = await ethers.getSigners();

  console.log("  SCENARIO 6: ZERO-STAKER REVENUE FALLBACK");

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
  const router = await ethers.getContractAt("RevenueRouter", event.args.revenueRouter);

  console.log("\n  Customer pays 10 ETH while NO investors are staked...");
  await router.connect(customer).routePayment({ value: ethers.parseEther("10") });

  const devLedger = await router.creatorPendingFunds();
  console.log(`   - Dev Ledger (OpEx + Yield Fallback): ${ethers.formatEther(devLedger)} ETH (Expected: 9.9)`);

  const treasuryLedger = await router.treasuryPendingFunds();
  console.log(`   - Treasury Ledger (1% Toll):          ${ethers.formatEther(treasuryLedger)} ETH (Expected: 0.1)`);
}

main().catch(console.error);
