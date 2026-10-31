import { expect } from "chai";
import {
  DAY,
  ethers,
  launchAndClaimProject,
  launchAndCompleteProject,
  launchAndFundProject,
  launchAndStartMilestoneProject,
  launchProject,
  networkHelpers,
} from "./helpers/protocol.js";

const { time } = networkHelpers;
const WINDOW = BigInt(90 * DAY);
const MUST_CANCEL = "Cancel project first";

describe("CON-02.33 shutdown only after cancel", function () {
  describe("active projects", function () {
    it("reverts during the funding phase, before and after goal", async function () {
      const open = await networkHelpers.loadFixture(launchProject);
      await expect(open.escrow.connect(open.treasury).emergencyShutdown()).to.be.revertedWith(MUST_CANCEL);

      const funded = await networkHelpers.loadFixture(launchAndFundProject);
      await expect(funded.escrow.connect(funded.treasury).emergencyShutdown()).to.be.revertedWith(MUST_CANCEL);
      expect(await funded.token.isInvalidated()).to.equal(false);
    });

    it("reverts after funding closed and tokens were claimed", async function () {
      const { escrow, token, treasury } = await networkHelpers.loadFixture(launchAndClaimProject);

      await expect(escrow.connect(treasury).emergencyShutdown()).to.be.revertedWith(MUST_CANCEL);
      expect(await token.isInvalidated()).to.equal(false);
      expect(await escrow.projectCancelled()).to.equal(false);
    });

    it("reverts while a vote is open", async function () {
      const { escrow, treasury } = await networkHelpers.loadFixture(launchAndStartMilestoneProject);

      await expect(escrow.connect(treasury).emergencyShutdown()).to.be.revertedWith(MUST_CANCEL);
    });

    it("checks the guardian first", async function () {
      const { escrow, developer } = await networkHelpers.loadFixture(launchAndClaimProject);

      await expect(escrow.connect(developer).emergencyShutdown()).to.be.revertedWith(
        "Only Guardian can trigger emergency shutdown",
      );
    });
  });

  describe("after a cancel", function () {
    it("reverts with 'Refunds still open' before 90 days and works exactly at the window", async function () {
      const { escrow, developer, treasury } = await networkHelpers.loadFixture(launchAndClaimProject);
      await escrow.connect(developer).cancelProject("stop");
      const at = await escrow.cancelledAt();

      await time.setNextBlockTimestamp(at + WINDOW - 1n);
      await expect(escrow.connect(treasury).emergencyShutdown()).to.be.revertedWith("Refunds still open");

      await time.setNextBlockTimestamp(at + WINDOW);
      await expect(escrow.connect(treasury).emergencyShutdown()).to.emit(escrow, "EmergencyShutdownTriggered");
    });

    it("works before 90 days once every public token is refunded", async function () {
      const { escrow, token, developer, treasury, alice, bob, carol } =
        await networkHelpers.loadFixture(launchAndClaimProject);
      await escrow.connect(developer).cancelProject("stop");
      for (const backer of [alice, bob, carol]) {
        await token.connect(backer).approve(await escrow.getAddress(), await token.balanceOf(backer.address));
        await escrow.connect(backer).refundDeadProject();
      }
      expect(await escrow.remainingPublicTokens()).to.equal(0n);

      await expect(escrow.connect(treasury).emergencyShutdown()).to.emit(escrow, "EmergencyShutdownTriggered");
      expect(await token.isInvalidated()).to.equal(true);
    });

    it("works after a failed-vote cancel once the window passed", async function () {
      const { escrow, token, treasury } = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      await time.increase(28 * DAY);
      await escrow.executeMilestone();
      expect(await escrow.projectCancelled()).to.equal(true);
      await expect(escrow.connect(treasury).emergencyShutdown()).to.be.revertedWith("Refunds still open");

      await time.increase(WINDOW);
      await expect(escrow.connect(treasury).emergencyShutdown()).to.emit(escrow, "EmergencyShutdownTriggered");
      expect(await token.isInvalidated()).to.equal(true);
    });

    it("reverts a second shutdown with 'Already shut down'", async function () {
      const { escrow, developer, treasury } = await networkHelpers.loadFixture(launchAndClaimProject);
      await escrow.connect(developer).cancelProject("stop");
      await time.increase(WINDOW);
      await escrow.connect(treasury).emergencyShutdown();

      await expect(escrow.connect(treasury).emergencyShutdown()).to.be.revertedWith("Already shut down");
    });

    it("is guardian only", async function () {
      const { escrow, developer, alice, outsider } = await networkHelpers.loadFixture(launchAndClaimProject);
      await escrow.connect(developer).cancelProject("stop");
      await time.increase(WINDOW);

      for (const caller of [developer, alice, outsider]) {
        await expect(escrow.connect(caller).emergencyShutdown()).to.be.revertedWith(
          "Only Guardian can trigger emergency shutdown",
        );
      }
    });
  });

  describe("completed project", function () {
    it("still shuts down immediately and records the cancel", async function () {
      const { escrow, token, treasury } = await networkHelpers.loadFixture(launchAndCompleteProject);
      expect(await escrow.completed()).to.equal(true);
      expect(await escrow.projectCancelled()).to.equal(false);

      await expect(escrow.connect(treasury).emergencyShutdown()).to.emit(escrow, "EmergencyShutdownTriggered");

      expect(await token.isInvalidated()).to.equal(true);
      expect(await escrow.projectCancelled()).to.equal(true);
      expect(await escrow.cancelledAt()).to.equal(BigInt(await time.latest()));
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(0n);
    });

    it("reverts a second shutdown with 'Already shut down'", async function () {
      const { escrow, treasury } = await networkHelpers.loadFixture(launchAndCompleteProject);
      await escrow.connect(treasury).emergencyShutdown();

      await expect(escrow.connect(treasury).emergencyShutdown()).to.be.revertedWith("Already shut down");
    });
  });
});
