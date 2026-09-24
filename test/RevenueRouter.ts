import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();

describe("RevenueRouter", function () {
  // 1. A setup function to deploy a fresh contract before our tests
  async function deployRouterFixture() {
    // Get fake accounts provided by Hardhat
    const [deployer, creatorAccount, customerAccount] = await ethers.getSigners();

    // Deploy the contract, passing the creator's address to the constructor
    const RevenueRouter = await ethers.getContractFactory("RevenueRouter");
    const router = await RevenueRouter.deploy(creatorAccount.address);

    return { router, creatorAccount, customerAccount };
  }

  // 2. The actual test
  describe("Routing Math", function () {
    it("Should instantly send 80% to the creator and keep 20% in the pool", async function () {
      // Load the fresh contract and our fake users
      const { router, creatorAccount, customerAccount } =
        await networkHelpers.loadFixture(deployRouterFixture);

      // Check how much money the creator has BEFORE the payment
      const initialCreatorBalance = await ethers.provider.getBalance(creatorAccount.address);

      // The customer sends 100 wei to the routePayment function
      const paymentAmount = 100n; // 'n' tells TypeScript this is a BigInt (required for Web3 math)
      await router.connect(customerAccount).routePayment({ value: paymentAmount });

      // Check the internal dividend pool (Should be 20 wei)
      const currentPool = await router.totalDividendPool();
      expect(currentPool).to.equal(20n);

      // Check the creator's wallet (Should have gained exactly 80 wei)
      const finalCreatorBalance = await ethers.provider.getBalance(creatorAccount.address);
      expect(finalCreatorBalance - initialCreatorBalance).to.equal(80n);
    });
  });
});
