import { network } from "hardhat";

async function main() {
  const { ethers } = await network.create();
  const [developer, investor1, investor2, treasury] = await ethers.getSigners();

  console.log("==========================================================");
  console.log("  SCENARIO 3: FULL ROADMAP EXECUTION & CLIFF VESTING");
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
  
  const tx = await factory.connect(developer).launchProject(
    "Acme SaaS", "ACME", 1000000n,
    ["M0: MVP Build", "M1: Beta Release", "M2: Mainnet V1"],
    [40n, 30n, 30n],
    ethers.parseEther("10"), 30n
  );
  const receipt = await tx.wait();
  const event = (await factory.queryFilter(factory.filters.ProjectLaunched(), receipt?.blockNumber))[0] as any;
  const token = await ethers.getContractAt("ProjectToken", event.args.projectToken);
  const escrow = await ethers.getContractAt("MilestoneEscrow", event.args.milestoneEscrow);
  const distributor = await ethers.getContractAt("DividendDistributor", event.args.dividendDistributor);

  await investor1.sendTransaction({ to: escrow.target, value: ethers.parseEther("5") });
  await investor2.sendTransaction({ to: escrow.target, value: ethers.parseEther("5") });
  await escrow.connect(developer).closeFundingAndStart();
  await escrow.connect(investor1).claimTokens();
  await escrow.connect(investor2).claimTokens();

  const inv1Bal = await token.balanceOf(investor1.address);
  const inv2Bal = await token.balanceOf(investor2.address);
  await token.connect(investor1).approve(distributor.target, inv1Bal);
  await distributor.connect(investor1).stake(inv1Bal);
  await token.connect(investor2).approve(distributor.target, inv2Bal);
  await distributor.connect(investor2).stake(inv2Bal);

  const chainId = (await ethers.provider.getNetwork()).chainId;

  console.log("\n  4. EXECUTING MILESTONE 0 (40%)");
  await escrow.connect(developer).startMilestone(0);
  await escrow.connect(investor1).vote(true);
  await escrow.connect(investor2).vote(true);
  
  let gasDebt = ethers.parseEther("0.02"); // 0.02 gas debt
  let msgHash = ethers.solidityPackedKeccak256(["address", "uint256", "uint256", "uint256"], [escrow.target, 0, chainId, gasDebt]);
  let sig = await treasury.signMessage(ethers.getBytes(msgHash));
  await escrow.connect(developer).executeMilestone(gasDebt, sig);

  console.log("\n  5. EXECUTING MILESTONE 1 (30%)");
  await escrow.connect(developer).startMilestone(1);
  await escrow.connect(investor1).vote(true);
  await escrow.connect(investor2).vote(true);
  
  gasDebt = 0n; // 0 gas debt
  msgHash = ethers.solidityPackedKeccak256(["address", "uint256", "uint256", "uint256"], [escrow.target, 1, chainId, gasDebt]);
  sig = await treasury.signMessage(ethers.getBytes(msgHash));
  await escrow.connect(developer).executeMilestone(gasDebt, sig);

  console.log("\n  6. EXECUTING MILESTONE 2 (30% & CLIFF VEST UNLOCK)");
  await escrow.connect(developer).startMilestone(2);
  await escrow.connect(investor1).vote(true);
  await escrow.connect(investor2).vote(true);
  
  gasDebt = ethers.parseEther("0.01"); // 0.01 gas debt
  msgHash = ethers.solidityPackedKeccak256(["address", "uint256", "uint256", "uint256"], [escrow.target, 2, chainId, gasDebt]);
  sig = await treasury.signMessage(ethers.getBytes(msgHash));
  await escrow.connect(developer).executeMilestone(gasDebt, sig);

  const devTokens = await token.balanceOf(developer.address);
  const finalEscrowEth = await ethers.provider.getBalance(escrow.target);

  if (devTokens === ethers.parseEther("200000") && finalEscrowEth === 0n) {
    console.log("\n  SCENARIO 3 PASSED: Full roadmap executed, ETH drained, and cliff-vested tokens successfully delivered to the founder!");
  } else {
    console.error("\n  SCENARIO 3 FAILED: Incorrect final payouts.");
  }
}
main().catch(console.error);
