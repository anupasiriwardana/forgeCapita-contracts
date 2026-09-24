import { network } from "hardhat";

async function main() {
  const { ethers } = await network.create();
  const [developer] = await ethers.getSigners();
  
  const FACTORY_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3"; 
  const factory = await ethers.getContractAt("ForgeCapitaFactory", FACTORY_ADDRESS);

  console.log(`🚀 Launching "Acme SaaS" from developer: ${developer.address}`);
  
  // Define the custom roadmap (must equal 100% total)
  const milestoneDescriptions = ["Initial Team Setup", "Beta Software Release", "Mainnet Public Launch"];
  const milestonePercentages = [40, 30, 30]; 
  
  // Execute the atomic deployment transaction with the new arrays
  const tx = await factory.launchProject(
      "Acme SaaS Equity", 
      "ACME", 
      1000000,
      milestoneDescriptions,
      milestonePercentages
  );
  
  const receipt = await tx.wait();

  // Parse the blockchain logs to find the ProjectLaunched event
  const filter = factory.filters.ProjectLaunched();
  const events = await factory.queryFilter(filter, receipt?.blockNumber, receipt?.blockNumber);

  if (events.length > 0) {
      const event = events[0] as any; 
      console.log("\n✅ ForgeCapita Ecosystem Successfully Deployed!");
      console.log("------------------------------------------------");
      console.log("Developer Wallet :", event.args[0]);
      console.log("Project Token    :", event.args[1]);
      console.log("Milestone Escrow :", event.args[2]);
      console.log("Div. Distributor :", event.args[3]);
      console.log("Revenue Router   :", event.args[4]);
      console.log("------------------------------------------------");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});