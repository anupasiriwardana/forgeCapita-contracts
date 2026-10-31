import { network } from "hardhat";

async function main() {
  const { ethers } = await network.create();
  const [dev, inv, treasury] = await ethers.getSigners();

  console.log("==========================================================");
  console.log("  SCENARIO 12: EMERGENCY SHUTDOWN AFTER MILESTONE 1");
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

  const tx = await factory.connect(dev).launchProject("SaaS", "SAS", 1000000n, ["M0", "M1"], [50n, 50n], ethers.parseEther("10"), 30n);
  const receipt = await tx.wait();
  const event = (await factory.queryFilter(factory.filters.ProjectLaunched(), receipt?.blockNumber))[0] as any;
  
  const token = await ethers.getContractAt("ProjectToken", event.args.projectToken);
  const escrow = await ethers.getContractAt("MilestoneEscrow", event.args.milestoneEscrow);
  const distributor = await ethers.getContractAt("DividendDistributor", event.args.dividendDistributor);

  await inv.sendTransaction({ to: escrow.target, value: ethers.parseEther("10") });
  await escrow.connect(dev).closeFundingAndStart();
  await escrow.connect(inv).claimTokens();
  
  const invBal = await token.balanceOf(inv.address);
  await token.connect(inv).approve(distributor.target, invBal);
  await distributor.connect(inv).stake(invBal);

  console.log("  Executing Milestone 0 normally...");
  await escrow.connect(dev).startMilestone(0);
  await escrow.connect(inv).vote(true);
  
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const msgHash = ethers.solidityPackedKeccak256(["address", "uint256", "uint256", "uint256"], [escrow.target, 0, chainId, 0n]);
  const sig = await treasury.signMessage(ethers.getBytes(msgHash));
  await escrow.connect(dev).executeMilestone(0n, sig);
  
  console.log("\n  EMERGENCY: Treasury initiates shutdown during Milestone 1...");
  const treasuryEthBefore = await ethers.provider.getBalance(treasury.address);
  const shutdownTx = await escrow.connect(treasury).emergencyShutdown();
  const shutdownReceipt = await shutdownTx.wait();
  const treasuryEthAfter = await ethers.provider.getBalance(treasury.address);
  
  const shutdownEvent = shutdownReceipt?.logs.map((log: any) => {
    try { return escrow.interface.parseLog(log); } catch { return null; }
  }).find((parsed: any) => parsed?.name === "EmergencyShutdownTriggered");
  const ethExtracted = shutdownEvent?.args.extractedETH;
  
  console.log(`   - Treasury successfully extracted: ${ethers.formatEther(ethExtracted)} ETH from Escrow`);
  
  const isInvalidated = await token.isInvalidated();
  console.log(`   - Token globally invalidated: ${isInvalidated}`);
  
  const escrowTokens = await token.balanceOf(escrow.target);
  console.log(`   - Escrow remaining tokens physically burned: ${escrowTokens === 0n}`);
  
  const escrowEth = await ethers.provider.getBalance(escrow.target);
  console.log(`   - Escrow remaining ETH drained: ${escrowEth === 0n}`);

  console.log("\n  Attempting token transfer post-shutdown...");
  try {
    await distributor.connect(inv).withdraw(invBal);
    console.log("  ERROR: Tokens unstaked/transferred after shutdown!");
  } catch (e: any) {
    console.log(`     Transfer Reverted properly: ${e.message.includes("Token is dead") || e.message.includes("Emergency Shutdown")}`);
  }
}

main().catch(console.error);
