import { network } from "hardhat";

async function main() {
  const { ethers } = await network.create();
  const [dev, seller, buyer, treasury] = await ethers.getSigners();

  console.log("  SCENARIO 7: P2P SECONDARY MARKET SWAP");

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
  
  const p2p = await ethers.getContractAt("P2PExchange", await factory.p2pExchange());

  const tx = await factory.connect(dev).launchProject("SaaS", "SAS", 1000000n, ["M0"], [100n], ethers.parseEther("1"), 30n);
  const receipt = await tx.wait();
  const event = (await factory.queryFilter(factory.filters.ProjectLaunched(), receipt?.blockNumber))[0] as any;
  
  const token = await ethers.getContractAt("ProjectToken", event.args.projectToken);
  const escrow = await ethers.getContractAt("MilestoneEscrow", event.args.milestoneEscrow);

  await seller.sendTransaction({ to: escrow.target, value: ethers.parseEther("1") });
  await escrow.connect(dev).closeFundingAndStart();
  await escrow.connect(seller).claimTokens();

  console.log("\n  Seller lists 100,000 tokens for 2 ETH...");
  const listAmount = ethers.parseEther("100000"); // 100k tokens
  
  await token.connect(seller).approve(p2p.target, listAmount);
  
  const sellerListBalBefore = await ethers.provider.getBalance(seller.address);
  await p2p.connect(seller).createListing(token.target, listAmount, ethers.parseEther("2"));
  const sellerListBalAfter = await ethers.provider.getBalance(seller.address);
  
  console.log(`     Seller listing creation gas cost: ${ethers.formatEther(sellerListBalBefore - sellerListBalAfter)} ETH (Investor pays)`);


  const treasuryBalBefore = await ethers.provider.getBalance(treasury.address);
  const sellerBalBefore = await ethers.provider.getBalance(seller.address);

  console.log("  Buyer fills the order...");
  
  const buyerBalBefore = await ethers.provider.getBalance(buyer.address);
  await p2p.connect(buyer).fillListing(0, { value: ethers.parseEther("2") });
  const buyerBalAfter = await ethers.provider.getBalance(buyer.address);
  // Buyer pays 2 ETH for the tokens, the rest is gas
  const gasSpentBuy = (buyerBalBefore - buyerBalAfter) - ethers.parseEther("2");
  
  console.log(`     Buyer fill listing gas cost: ${ethers.formatEther(gasSpentBuy)} ETH (Investor pays)`);

  const buyerTokens = await token.balanceOf(buyer.address);
  const treasuryFee = (await ethers.provider.getBalance(treasury.address)) - treasuryBalBefore;
  const sellerProfitRaw = (await ethers.provider.getBalance(seller.address)) - sellerBalBefore;

  console.log(`   - Buyer Received:   ${ethers.formatEther(buyerTokens)} ACME (Expected: 100000.0)`);
  console.log(`   - Treasury Fee:     ${ethers.formatEther(treasuryFee)} ETH (Expected: 0.02)`);
  console.log(`   - Seller Received ~ ${ethers.formatEther(sellerProfitRaw).substring(0, 4)} ETH (Expected: 1.98)`);
}

main().catch(console.error);
