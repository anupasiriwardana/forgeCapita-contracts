import { expect } from "chai";
import {
  ethers,
  etherDelta,
  launchAndClaimProject,
  launchAndStartMilestoneProject,
  networkHelpers,
} from "./helpers/protocol.js";

const eth = ethers.parseEther;

describe("RevenueRouter", function () {
  describe("routePayment with stakers", function () {
    it("sends 75% to the distributor", async function () {
      const { router, distributor, outsider } = await networkHelpers.loadFixture(
        launchAndStartMilestoneProject,
      );

      await router.connect(outsider).routePayment({ value: eth("10") });

      expect(await ethers.provider.getBalance(await distributor.getAddress())).to.equal(eth("7.5"));
    });

    it("books 24% for the creator and 1% for the treasury", async function () {
      const { router, outsider } = await networkHelpers.loadFixture(launchAndStartMilestoneProject);

      await router.connect(outsider).routePayment({ value: eth("10") });

      expect(await router.creatorPendingFunds()).to.equal(eth("2.4"));
      expect(await router.treasuryPendingFunds()).to.equal(eth("0.1"));
    });

    it("emits PaymentReceived with the split", async function () {
      const { router, outsider } = await networkHelpers.loadFixture(launchAndStartMilestoneProject);

      await expect(router.connect(outsider).routePayment({ value: eth("10") }))
        .to.emit(router, "PaymentReceived")
        .withArgs(outsider.address, eth("10"), eth("2.4"), eth("7.5"), eth("0.1"));
    });

    it("reverts when no ETH is sent", async function () {
      const { router, outsider } = await networkHelpers.loadFixture(launchAndStartMilestoneProject);

      await expect(router.connect(outsider).routePayment({ value: 0n })).to.be.revertedWith(
        "You must send ETH to pay.",
      );
    });
  });

  describe("routePayment without stakers", function () {
    it("rolls the investor share over to the creator", async function () {
      const { router, outsider } = await networkHelpers.loadFixture(launchAndClaimProject);

      await router.connect(outsider).routePayment({ value: eth("10") });

      expect(await router.creatorPendingFunds()).to.equal(eth("9.9"));
      expect(await router.treasuryPendingFunds()).to.equal(eth("0.1"));
    });

    it("does not send anything to the distributor", async function () {
      const { router, distributor, outsider } = await networkHelpers.loadFixture(
        launchAndClaimProject,
      );

      await router.connect(outsider).routePayment({ value: eth("10") });

      expect(await ethers.provider.getBalance(await distributor.getAddress())).to.equal(0n);
    });
  });

  describe("claimCreatorFunds", function () {
    it("pays the pending creator funds to the developer and resets them", async function () {
      const { router, developer, outsider } = await networkHelpers.loadFixture(
        launchAndStartMilestoneProject,
      );
      await router.connect(outsider).routePayment({ value: eth("10") });

      const delta = await etherDelta(developer.address, () =>
        router.connect(developer).claimCreatorFunds(),
      );

      expect(delta).to.equal(eth("2.4"));
      expect(await router.creatorPendingFunds()).to.equal(0n);
    });

    it("emits FundsClaimed", async function () {
      const { router, developer, outsider } = await networkHelpers.loadFixture(
        launchAndStartMilestoneProject,
      );
      await router.connect(outsider).routePayment({ value: eth("10") });

      await expect(router.connect(developer).claimCreatorFunds())
        .to.emit(router, "FundsClaimed")
        .withArgs(developer.address, eth("2.4"));
    });

    it("reverts for anyone but the active developer", async function () {
      const { router, outsider } = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      await router.connect(outsider).routePayment({ value: eth("10") });

      await expect(router.connect(outsider).claimCreatorFunds()).to.be.revertedWith(
        "Only active developer can claim",
      );
    });

    it("reverts when nothing is pending", async function () {
      const { router, developer } = await networkHelpers.loadFixture(launchAndStartMilestoneProject);

      await expect(router.connect(developer).claimCreatorFunds()).to.be.revertedWith(
        "No funds to claim",
      );
    });

    it("follows the developer role to the new developer", async function () {
      const { router, escrow, developer, outsider, alice } = await networkHelpers.loadFixture(
        launchAndStartMilestoneProject,
      );
      await router.connect(alice).routePayment({ value: eth("10") });
      await escrow.connect(developer).proposeNewDeveloper(outsider.address);
      await escrow.connect(outsider).acceptDeveloperRole();

      await expect(router.connect(developer).claimCreatorFunds()).to.be.revertedWith(
        "Only active developer can claim",
      );
      const delta = await etherDelta(outsider.address, () =>
        router.connect(outsider).claimCreatorFunds(),
      );
      expect(delta).to.equal(eth("2.4"));
    });
  });

  describe("claimTreasuryFunds", function () {
    it("pays the pending platform fee to the treasury", async function () {
      const { router, treasury, outsider } = await networkHelpers.loadFixture(
        launchAndStartMilestoneProject,
      );
      await router.connect(outsider).routePayment({ value: eth("10") });

      const delta = await etherDelta(treasury.address, () =>
        router.connect(outsider).claimTreasuryFunds(),
      );

      expect(delta).to.equal(eth("0.1"));
      expect(await router.treasuryPendingFunds()).to.equal(0n);
    });

    it("reverts when nothing is pending", async function () {
      const { router, outsider } = await networkHelpers.loadFixture(launchAndStartMilestoneProject);

      await expect(router.connect(outsider).claimTreasuryFunds()).to.be.revertedWith(
        "No funds to claim",
      );
    });
  });
});
