import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const RevenueRouterModule = buildModule("RevenueRouterModule", (m) => {
  // Hardhat gives us 20 fake accounts. We will use Account #1 as our "Creator" for local testing.
  const creatorAddress = m.getAccount(1); 

  // Deploy the contract, passing the creator's address into the constructor
  const router = m.contract("RevenueRouter", [creatorAddress]);

  return { router };
});

export default RevenueRouterModule;