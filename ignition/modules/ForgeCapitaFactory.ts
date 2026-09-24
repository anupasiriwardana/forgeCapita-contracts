import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("ForgeCapitaFactoryModule", (m) => {
  // Deploy the master Factory contract
  const factory = m.contract("ForgeCapitaFactory");

  return { factory };
});
