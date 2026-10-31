import { expect } from "chai";
import {
  DAY,
  FUNDING_GOAL,
  ethers,
  etherDelta,
  launchAndFundProject,
  launchProject,
  networkHelpers,
  sendEth,
} from "./helpers/protocol.js";
import { eth } from "./helpers/extra.js";

const { time } = networkHelpers;
const GRACE = BigInt(14 * DAY);

async function fundedWithGoalMissing() {
  const project = await launchProject();
  await sendEth(project.alice, await project.escrow.getAddress(), eth("4"));
  await sendEth(project.bob, await project.escrow.getAddress(), eth("3"));
  return project;
}

describe("CON-02.31 stuck funding", function () {
  it("exposes CLOSE_GRACE as 14 days", async function () {
    const { escrow } = await networkHelpers.loadFixture(launchProject);

    expect(await escrow.CLOSE_GRACE()).to.equal(GRACE);
  });

  describe("goal met, developer never closes", function () {
    it("blocks refunds inside the close window with a clear message", async function () {
      const { escrow, alice } = await networkHelpers.loadFixture(launchAndFundProject);
      const deadline = await escrow.fundingDeadline();

      await time.setNextBlockTimestamp(deadline + 1n);
      await expect(escrow.connect(alice).refundFailedCrowdfund()).to.be.revertedWith(
        "Close window still open",
      );
    });

    it("keeps reverting exactly at deadline + 14 days and refunds one second later", async function () {
      const { escrow, alice } = await networkHelpers.loadFixture(launchAndFundProject);
      const deadline = await escrow.fundingDeadline();

      await time.setNextBlockTimestamp(deadline + GRACE);
      await expect(escrow.connect(alice).refundFailedCrowdfund()).to.be.revertedWith(
        "Close window still open",
      );

      await time.setNextBlockTimestamp(deadline + GRACE + 1n);
      expect(await etherDelta(alice.address, () => escrow.connect(alice).refundFailedCrowdfund())).to.equal(eth("4"));
    });

    it("refunds every investor in full, with no fee", async function () {
      const { escrow, alice, bob, carol } = await networkHelpers.loadFixture(launchAndFundProject);
      await time.increaseTo((await escrow.fundingDeadline()) + GRACE + 1n);

      expect(await etherDelta(alice.address, () => escrow.connect(alice).refundFailedCrowdfund())).to.equal(eth("4"));
      expect(await etherDelta(bob.address, () => escrow.connect(bob).refundFailedCrowdfund())).to.equal(eth("3"));
      expect(await etherDelta(carol.address, () => escrow.connect(carol).refundFailedCrowdfund())).to.equal(eth("3"));
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(0n);
    });

    it("does not refund twice", async function () {
      const { escrow, alice } = await networkHelpers.loadFixture(launchAndFundProject);
      await time.increaseTo((await escrow.fundingDeadline()) + GRACE + 1n);
      await escrow.connect(alice).refundFailedCrowdfund();

      await expect(escrow.connect(alice).refundFailedCrowdfund()).to.be.revertedWith("No funds to refund");
    });

    it("reverts for a stranger without a deposit", async function () {
      const { escrow, outsider } = await networkHelpers.loadFixture(launchAndFundProject);
      await time.increaseTo((await escrow.fundingDeadline()) + GRACE + 1n);

      await expect(escrow.connect(outsider).refundFailedCrowdfund()).to.be.revertedWith("No funds to refund");
    });

    it("lets the developer close inside the window", async function () {
      const early = await networkHelpers.loadFixture(launchAndFundProject);
      await time.increaseTo((await early.escrow.fundingDeadline()) + 7n * BigInt(DAY));
      await early.escrow.connect(early.developer).closeFundingAndStart();
      expect(await early.escrow.isFundingActive()).to.equal(false);
    });

    it("lets the developer close exactly at deadline + 14 days", async function () {
      const { escrow, developer } = await networkHelpers.loadFixture(launchAndFundProject);
      await time.setNextBlockTimestamp((await escrow.fundingDeadline()) + GRACE);

      await escrow.connect(developer).closeFundingAndStart();
      expect(await escrow.totalRaised()).to.equal(FUNDING_GOAL);
    });

    it("reverts the close one second after the window with 'Close window ended'", async function () {
      const { escrow, developer } = await networkHelpers.loadFixture(launchAndFundProject);
      await time.setNextBlockTimestamp((await escrow.fundingDeadline()) + GRACE + 1n);

      await expect(escrow.connect(developer).closeFundingAndStart()).to.be.revertedWith("Close window ended");
    });

    it("keeps close developer-only", async function () {
      const { escrow, alice } = await networkHelpers.loadFixture(launchAndFundProject);

      await expect(escrow.connect(alice).closeFundingAndStart()).to.be.revertedWith("Only developer can call");
    });

    it("cannot be refunded after a successful close", async function () {
      const { escrow, developer, alice } = await networkHelpers.loadFixture(launchAndFundProject);
      await escrow.connect(developer).closeFundingAndStart();
      await time.increaseTo((await escrow.fundingDeadline()) + GRACE + 1n);

      await expect(escrow.connect(alice).refundFailedCrowdfund()).to.be.revertedWith(
        "Funding already closed successfully",
      );
    });
  });

  describe("goal not met", function () {
    it("refunds right after the deadline, as before", async function () {
      const { escrow, alice } = await networkHelpers.loadFixture(fundedWithGoalMissing);
      await time.setNextBlockTimestamp((await escrow.fundingDeadline()) + 1n);

      expect(await etherDelta(alice.address, () => escrow.connect(alice).refundFailedCrowdfund())).to.equal(eth("4"));
    });

    it("still reverts before the deadline", async function () {
      const { escrow, alice } = await networkHelpers.loadFixture(fundedWithGoalMissing);

      await expect(escrow.connect(alice).refundFailedCrowdfund()).to.be.revertedWith("Deadline not reached yet");
    });

    it("does not let the developer close without the goal, and not after the window", async function () {
      const { escrow, developer } = await networkHelpers.loadFixture(fundedWithGoalMissing);
      const deadline = await escrow.fundingDeadline();

      await time.setNextBlockTimestamp(deadline + 1n);
      await expect(escrow.connect(developer).closeFundingAndStart()).to.be.revertedWith("Funding goal not reached");

      await time.setNextBlockTimestamp(deadline + GRACE + 1n);
      await expect(escrow.connect(developer).closeFundingAndStart()).to.be.revertedWith("Close window ended");
    });

    it("still refunds after the grace period", async function () {
      const { escrow, bob } = await networkHelpers.loadFixture(fundedWithGoalMissing);
      await time.increaseTo((await escrow.fundingDeadline()) + GRACE + 1n);

      expect(await etherDelta(bob.address, () => escrow.connect(bob).refundFailedCrowdfund())).to.equal(eth("3"));
    });
  });

  describe("investing", function () {
    it("stays blocked after the deadline, also inside the close window", async function () {
      const { escrow, alice } = await networkHelpers.loadFixture(launchAndFundProject);
      const escrowAddress = await escrow.getAddress();
      await time.setNextBlockTimestamp((await escrow.fundingDeadline()) + 1n);

      await expect(sendEth(alice, escrowAddress, eth("1"))).to.be.revertedWith("Funding deadline has passed");
    });

    it("is allowed exactly at the deadline", async function () {
      const { escrow, alice } = await networkHelpers.loadFixture(launchAndFundProject);
      await time.setNextBlockTimestamp(await escrow.fundingDeadline());

      await sendEth(alice, await escrow.getAddress(), eth("1"));
      expect(await escrow.deposits(alice.address)).to.equal(eth("5"));
    });
  });
});
