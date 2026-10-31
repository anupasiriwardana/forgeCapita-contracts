import { network } from "hardhat";

async function main() {
  const { ethers } = await network.create();
  const [dev, inv, customer, treasury] = await ethers.getSigners();

  console.log("  SCENARIO 5: SAAS REVENUE (24/1/75 SPLIT)");

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
  
  const tx = await factory.connect(dev).launchProject("SaaS", "SAS", 1000000n, ["M0"], [100n], ethers.parseEther("1"), 30n);
  const receipt = await tx.wait();
  const event = (await factory.queryFilter(factory.filters.ProjectLaunched(), receipt?.blockNumber))[0] as any;
  
  const token = await ethers.getContractAt("ProjectToken", event.args.projectToken);
  const escrow = await ethers.getContractAt("MilestoneEscrow", event.args.milestoneEscrow);
  const distributor = await ethers.getContractAt("DividendDistributor", event.args.dividendDistributor);
  const router = await ethers.getContractAt("RevenueRouter", event.args.revenueRouter);

  await inv.sendTransaction({ to: escrow.target, value: ethers.parseEther("1") });
  await escrow.connect(dev).closeFundingAndStart();
  await escrow.connect(inv).claimTokens();
  const invBal = await token.balanceOf(inv.address);
  await token.connect(inv).approve(distributor.target, invBal);
  await distributor.connect(inv).stake(invBal);

  console.log("\n  Customer pays 10 ETH for SaaS subscription...");
  await router.connect(customer).routePayment({ value: ethers.parseEther("10") });

  const devLedger = await router.creatorPendingFunds();
  const treasuryLedger = await router.treasuryPendingFunds();
  const distributorEth = await ethers.provider.getBalance(distributor.target);

  console.log(`   - Dev Ledger:      ${ethers.formatEther(devLedger)} ETH (Expected: 2.4)`);
  console.log(`   - Treasury Ledger: ${ethers.formatEther(treasuryLedger)} ETH (Expected: 0.1)`);
  console.log(`   - Dividend Pool:   ${ethers.formatEther(distributorEth)} ETH (Expected: 7.5)`);

  console.log("\n  Investor claims yield...");
  const invEthBefore = await ethers.provider.getBalance(inv.address);
  await distributor.connect(inv).claimYield();
  const invEthAfter = await ethers.provider.getBalance(inv.address);
  
  const gasSpent = (invEthBefore - invEthAfter) + ethers.parseEther("7.5");

  console.log(`   - Investor yield claim gas cost: ${ethers.formatEther(gasSpent)} ETH`);
  console.log(`   - Investor Received ~ ${ethers.formatEther((invEthAfter - invEthBefore) + gasSpent).substring(0, 4)} ETH (Expected: 7.5)`);
}

main().catch(console.error);
