import { expect } from "chai";
import {
  ONE_TOKEN,
  ethers,
  etherDelta,
  launchAndClaimProject,
  launchAndStartMilestoneProject,
  launchProject,
  networkHelpers,
  sendEth,
} from "./helpers/protocol.js";

const eth = ethers.parseEther;

describe("DividendDistributor", function () {
  describe("stake", function () {
    it("moves tokens into the distributor and tracks the staker's balance", async function () {
      const { token, distributor, escrow, alice } =
        await networkHelpers.loadFixture(launchAndClaimProject);
      const amount = 100n * ONE_TOKEN;
      await token.connect(alice).approve(await distributor.getAddress(), amount);

      await expect(distributor.connect(alice).stake(amount))
        .to.emit(distributor, "Staked")
        .withArgs(alice.address, amount);

      expect(await distributor.stakedBalance(alice.address)).to.equal(amount);
      expect(await distributor.totalStaked()).to.equal(amount);
      expect(await token.balanceOf(await distributor.getAddress())).to.equal(amount);
      expect(await token.balanceOf(alice.address)).to.equal(320n * ONE_TOKEN - amount);
      expect(await distributor.milestoneEscrow()).to.equal(await escrow.getAddress());
    });

    it("reverts when staking zero", async function () {
      const { distributor, alice } = await networkHelpers.loadFixture(launchAndClaimProject);

      await expect(distributor.connect(alice).stake(0n)).to.be.revertedWith("Cannot stake 0");
    });

    it("reverts without token allowance", async function () {
      const { token, distributor, alice } = await networkHelpers.loadFixture(launchAndClaimProject);

      await expect(distributor.connect(alice).stake(1n)).to.be.revertedWithCustomError(
        token,
        "ERC20InsufficientAllowance",
      );
    });
  });

  describe("withdraw", function () {
    it("returns staked tokens to the staker", async function () {
      const { token, distributor, bob } = await networkHelpers.loadFixture(
        launchAndStartMilestoneProject,
      );
      const amount = 40n * ONE_TOKEN;

      await expect(distributor.connect(bob).withdraw(amount))
        .to.emit(distributor, "Withdrawn")
        .withArgs(bob.address, amount);

      expect(await token.balanceOf(bob.address)).to.equal(amount);
      expect(await distributor.stakedBalance(bob.address)).to.equal(200n * ONE_TOKEN);
      expect(await distributor.totalStaked()).to.equal(760n * ONE_TOKEN);
    });

    it("reverts when withdrawing zero", async function () {
      const { distributor, bob } = await networkHelpers.loadFixture(launchAndStartMilestoneProject);

      await expect(distributor.connect(bob).withdraw(0n)).to.be.revertedWith(
        "Cannot withdraw 0",
      );
    });

    it("reverts when withdrawing more than staked", async function () {
      const { distributor, bob } = await networkHelpers.loadFixture(launchAndStartMilestoneProject);

      await expect(distributor.connect(bob).withdraw(241n * ONE_TOKEN)).to.be.revertedWith(
        "Insufficient staked balance",
      );
    });
  });

  describe("claimYield", function () {
    it("pays each staker their share of a routed payment", async function () {
      const { router, distributor, outsider, alice, bob } = await networkHelpers.loadFixture(
        launchAndStartMilestoneProject,
      );
      await router.connect(outsider).routePayment({ value: eth("10") });

      expect(await distributor.getClaimableYield(alice.address)).to.equal(eth("3"));
      expect(await distributor.getClaimableYield(bob.address)).to.equal(eth("2.25"));
      const delta = await etherDelta(alice.address, () => distributor.connect(alice).claimYield());
      expect(delta).to.equal(eth("3"));
    });

    it("emits YieldClaimed", async function () {
      const { router, distributor, outsider, alice } = await networkHelpers.loadFixture(
        launchAndStartMilestoneProject,
      );
      await router.connect(outsider).routePayment({ value: eth("10") });

      await expect(distributor.connect(alice).claimYield())
        .to.emit(distributor, "YieldClaimed")
        .withArgs(alice.address, eth("3"));
    });

    it("keeps accrued yield after the staker withdraws", async function () {
      const { router, distributor, outsider, alice } = await networkHelpers.loadFixture(
        launchAndStartMilestoneProject,
      );
      await router.connect(outsider).routePayment({ value: eth("10") });
      await distributor.connect(alice).withdraw(320n * ONE_TOKEN);

      const delta = await etherDelta(alice.address, () => distributor.connect(alice).claimYield());

      expect(delta).to.equal(eth("3"));
    });

    it("splits later payments only among current stakers", async function () {
      const { router, distributor, outsider, alice, bob } = await networkHelpers.loadFixture(
        launchAndStartMilestoneProject,
      );
      await distributor.connect(alice).withdraw(320n * ONE_TOKEN);
      await router.connect(outsider).routePayment({ value: eth("10") });

      expect(await distributor.getClaimableYield(alice.address)).to.equal(0n);
      expect(await distributor.getClaimableYield(bob.address)).to.equal(eth("3.75"));
    });

    it("reverts on a second claim of the same yield", async function () {
      const { router, distributor, outsider, alice } = await networkHelpers.loadFixture(
        launchAndStartMilestoneProject,
      );
      await router.connect(outsider).routePayment({ value: eth("10") });
      await distributor.connect(alice).claimYield();

      await expect(distributor.connect(alice).claimYield()).to.be.revertedWith(
        "No yield available",
      );
    });

    it("reverts when there is no yield", async function () {
      const { distributor, alice } = await networkHelpers.loadFixture(
        launchAndStartMilestoneProject,
      );

      await expect(distributor.connect(alice).claimYield()).to.be.revertedWith(
        "No yield available",
      );
    });
  });

  describe("receive", function () {
    it("accepts ETH and emits DividendsDeposited while tokens are staked", async function () {
      const { distributor, outsider } = await networkHelpers.loadFixture(
        launchAndStartMilestoneProject,
      );

      await expect(sendEth(outsider, await distributor.getAddress(), eth("1")))
        .to.emit(distributor, "DividendsDeposited")
        .withArgs(eth("1"));
    });

    it("reverts when nothing is staked", async function () {
      const { distributor, outsider } = await networkHelpers.loadFixture(launchProject);

      await expect(sendEth(outsider, await distributor.getAddress(), eth("1"))).to.be.revertedWith(
        "No tokens staked to receive dividends",
      );
    });
  });

  describe("initialisation and linking", function () {
    it("only lets the factory link the escrow", async function () {
      const { distributor, outsider } = await networkHelpers.loadFixture(launchProject);

      await expect(
        distributor.connect(outsider).setMilestoneEscrow(outsider.address),
      ).to.be.revertedWith("Only factory can link escrow");
    });

    it("emitted EscrowLinked when the factory linked the escrow during launch", async function () {
      const { distributor, escrow, launchTx } = await networkHelpers.loadFixture(launchProject);

      await expect(launchTx)
        .to.emit(distributor, "EscrowLinked")
        .withArgs(await escrow.getAddress());
    });

    it("cannot be initialised a second time", async function () {
      const { distributor, token, outsider } = await networkHelpers.loadFixture(launchProject);

      await expect(
        distributor.connect(outsider).initialize(await token.getAddress(), outsider.address, outsider.address),
      ).to.be.revertedWithCustomError(distributor, "InvalidInitialization");
    });
  });
});
