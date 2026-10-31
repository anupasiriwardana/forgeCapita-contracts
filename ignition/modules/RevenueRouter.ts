import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * Standalone RevenueRouter master implementation (no-arg constructor; per-project routers are
 * clones initialised by the Factory). The full deployment flow lives in ForgeCapitaFactory.ts,
 * which already deploys this master; use this module only to deploy the master on its own.
 */
const RevenueRouterModule = buildModule("RevenueRouterModule", (m) => {
  const router = m.contract("RevenueRouter");

  return { router };
});

export default RevenueRouterModule;
