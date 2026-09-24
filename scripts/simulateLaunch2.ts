import { network } from "hardhat";

async function main() {
  const { ethers } = await network.create();
  
  // 1. Grab 3 separate test wallets
  const [developer, investor1, investor2] = await ethers.getSigners();
  
  // ⚠️ UPDATE THIS AFTER REDEPLOYING YOUR FACTORY
  const FACTORY_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3"; 
  
  const factory = await ethers.getContractAt("ForgeCapitaFactory", FACTORY_ADDRESS);

  console.log(`🚀 Launching "Acme SaaS"...`);
  
  // Deploy with a simple 1-stage milestone for testing
  const tx = await factory.launchProject(
      "Acme SaaS", 
      "ACME", 
      1000000, // 1 Million tokens
      ["Full Project Delivery"],
      [100]
  );
  const receipt = await tx.wait();

  // Extract the new contract addresses
  const filter = factory.filters.ProjectLaunched();
  const events = await factory.queryFilter(filter, receipt?.blockNumber, receipt?.blockNumber);
  const event = events[0] as any; 
  
  const tokenAddress = event.args[1];
  const escrowAddress = event.args[2];

  console.log(`✅ Project Deployed! Escrow is at: ${escrowAddress}`);

  // Connect to the deployed Escrow and Token contracts
  const escrow = await ethers.getContractAt("MilestoneEscrow", escrowAddress);
  // We use standard ERC20 interface to read balances
  const token = await ethers.getContractAt("ProjectToken", tokenAddress); 

  // ---------------------------------------------------------
  // SCENARIO SIMULATION
  // ---------------------------------------------------------

  console.log(`\n💰 1. CROWDFUNDING PHASE`);
  
  // Investor 1 sends 3 ETH (30% of total)
  console.log(`   Investor 1 sending 3 ETH...`);
  await investor1.sendTransaction({ to: escrowAddress, value: ethers.parseEther("3") });
  
  // Investor 2 sends 7 ETH (70% of total)
  console.log(`   Investor 2 sending 7 ETH...`);
  await investor2.sendTransaction({ to: escrowAddress, value: ethers.parseEther("7") });

  console.log(`\n🔒 2. CLOSING FUNDING`);
  console.log(`   Developer locking vault and starting milestones...`);
  // The developer wallet calls the close function
  await escrow.connect(developer).closeFundingAndStart();

  console.log(`\n🎟️ 3. CLAIMING TOKENS`);
  console.log(`   Investors pulling their equity from the Escrow...`);
  // Investors connect their wallets to the contract and execute the pull
  await escrow.connect(investor1).claimTokens();
  await escrow.connect(investor2).claimTokens();

  console.log(`\n📊 4. VERIFYING PROPORTIONAL MATH`);
  // Read the token balances (formatEther converts the 18 decimals back to readable numbers)
  const bal1 = await token.balanceOf(investor1.address);
  const bal2 = await token.balanceOf(investor2.address);
  
  console.log(`   Investor 1 Token Balance: ${ethers.formatEther(bal1)} ACME`);
  console.log(`   Investor 2 Token Balance: ${ethers.formatEther(bal2)} ACME`);
  console.log(`   Expected Split: 300,000 / 700,000`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});