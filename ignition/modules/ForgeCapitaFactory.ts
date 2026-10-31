import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * Deploy order: Registry -> four master implementations -> Factory.
 * The Factory creates the P2PExchange itself (constructed with the registry), so it is not deployed here.
 *
 * `admin` becomes the initial treasury AND guardian of the registry. It defaults to the
 * deployer (account 0); override with a module parameter to start with a different admin.
 */
export default buildModule("ForgeCapitaFactoryModule", (m) => {
  const admin = m.getParameter("admin", m.getAccount(0));

  const registry = m.contract("ForgeCapitaRegistry", [admin]);

  const masterToken = m.contract("ProjectToken", [], { id: "MasterProjectToken" });
  const masterEscrow = m.contract("MilestoneEscrow", [], { id: "MasterMilestoneEscrow" });
  const masterDistributor = m.contract("DividendDistributor", [], { id: "MasterDividendDistributor" });
  const masterRouter = m.contract("RevenueRouter", [], { id: "MasterRevenueRouter" });

  const factory = m.contract("ForgeCapitaFactory", [
    masterToken,
    masterEscrow,
    masterDistributor,
    masterRouter,
    registry,
  ]);

  return { registry, masterToken, masterEscrow, masterDistributor, masterRouter, factory };
});
