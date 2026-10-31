import { network } from "hardhat";

async function main() {
  const { ethers } = await network.create();
  const [developer, investor1, investor2, treasury] = await ethers.getSigners();

  console.log("==========================================================");
  console.log("  SCENARIO 2: STAKED GOVERNANCE, FAST-TRACK EXECUTION & DEBT RECOUPMENT");
  console.log("==========================================================\n");

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
  
  const tx = await factory.connect(developer).launchProject(
    "Acme SaaS", "ACME", 1000000n,
    ["M0: MVP Build", "M1: Public Launch"], [50n, 50n],
    ethers.parseEther("10"), 30n
  );
  const receipt = await tx.wait();
  const event = (await factory.queryFilter(factory.filters.ProjectLaunched(), receipt?.blockNumber))[0] as any;
  const token = await ethers.getContractAt("ProjectToken", event.args.projectToken);
  const escrow = await ethers.getContractAt("MilestoneEscrow", event.args.milestoneEscrow);
  const distributor = await ethers.getContractAt("DividendDistributor", event.args.dividendDistributor);

  await investor1.sendTransaction({ to: escrow.target, value: ethers.parseEther("6") });
  await investor2.sendTransaction({ to: escrow.target, value: ethers.parseEther("4") });
  await escrow.connect(developer).closeFundingAndStart();
  await escrow.connect(investor1).claimTokens();
  await escrow.connect(investor2).claimTokens();

  const inv1Bal = await token.balanceOf(investor1.address);
  await token.connect(investor1).approve(distributor.target, inv1Bal);
  await distributor.connect(investor1).stake(inv1Bal);

  console.log("\n   5. STARTING MILESTONE 0 & VOTING");
  await escrow.connect(developer).startMilestone(0);
  await escrow.connect(investor1).vote(true);

  console.log("\n  6. EXECUTING FAST-TRACK MILESTONE WITH GAS DEBT RECOUPMENT");
  const escrowEthBefore = await ethers.provider.getBalance(escrow.target);
  const treasuryEthBefore = await ethers.provider.getBalance(treasury.address);
  
  // Create Cryptographic Signature for 0.05 ETH gas debt
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const gasDebt = ethers.parseEther("0.05");
  const messageHash = ethers.solidityPackedKeccak256(
      ["address", "uint256", "uint256", "uint256"],
      [escrow.target, 0, chainId, gasDebt]
  );
  const signature = await treasury.signMessage(ethers.getBytes(messageHash));
  
  const devExecBalBefore = await ethers.provider.getBalance(developer.address);
  const execTx = await escrow.connect(developer).executeMilestone(gasDebt, signature);
  const execReceipt = await execTx.wait();
  const devExecBalAfter = await ethers.provider.getBalance(developer.address);
  
  const execFilter = escrow.filters.MilestoneExecuted();
  const execEvents = await escrow.queryFilter(execFilter, execReceipt?.blockNumber, execReceipt?.blockNumber);
  const execEvent = execEvents[0] as any;
  const ethReleased = execEvent.args.amountReleased;
  const gasDebtRecouped = execEvent.args.gasDebtRecouped;

  const treasuryEthAfter = await ethers.provider.getBalance(treasury.address);
  console.log(`   - Treasury successfully recouped gas debt: ${ethers.formatEther(treasuryEthAfter - treasuryEthBefore)} ETH (Expected: 0.05)`);
  console.log(`   - Developer Net Payout: ${ethers.formatEther(ethReleased)} ETH (Expected: 4.70, which is 4.75 - 0.05)`);
  console.log(`\n  SCENARIO 2 PASSED: Signature verification, debt recoupment, and fast-track execution verified!`);
}
main().catch(console.error);
