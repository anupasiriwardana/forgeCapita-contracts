import { expect } from "chai";
import {
  DAY,
  ONE_TOKEN,
  approveAndExecuteMilestone,
  launchAndClaimProject,
  launchAndCompleteProject,
  launchAndStartMilestoneProject,
  networkHelpers,
} from "./helpers/protocol.js";

const { time } = networkHelpers;

/**
 * Regression tests for the v1 issues F1 and F2 (see docs/v2-design.md, section 3).
 * They were written first as failing tests against the v1 contracts and pass since v2.
 */
describe("Regressions: v1 fixes", function () {
  describe("F1: refund right after funding closes", function () {
    it("keeps refundDeadProject closed while milestone 0 has not started", async function () {
      const { escrow, token, alice } = await networkHelpers.loadFixture(launchAndClaimProject);
      expect(await escrow.projectCancelled()).to.equal(false);
      expect((await escrow.milestones(0)).isVotingOpen).to.equal(false);
      await token.connect(alice).approve(await escrow.getAddress(), 320n * ONE_TOKEN);

      await expect(escrow.connect(alice).refundDeadProject()).to.be.revertedWith(
        "Project is not cancelled",
      );
    });

    it("keeps refundDeadProject closed however long milestone 0 stays unstarted", async function () {
      const { escrow, token, alice } = await networkHelpers.loadFixture(launchAndClaimProject);
      await token.connect(alice).approve(await escrow.getAddress(), 320n * ONE_TOKEN);
      await time.increase(400 * DAY);

      await expect(escrow.connect(alice).refundDeadProject()).to.be.revertedWith(
        "Project is not cancelled",
      );
    });
  });

  describe("F2: refund on a completed project", function () {
    it("keeps refundDeadProject closed 120 days after the final milestone executed", async function () {
      const { escrow, token, alice } = await networkHelpers.loadFixture(launchAndCompleteProject);
      await time.increase(121 * DAY);
      expect(await escrow.projectCancelled()).to.equal(false);
      expect(await token.balanceOf(alice.address)).to.equal(320n * ONE_TOKEN);
      await token.connect(alice).approve(await escrow.getAddress(), 320n * ONE_TOKEN);

      await expect(escrow.connect(alice).refundDeadProject()).to.be.revertedWith(
        "Project is completed",
      );
    });

    it("sets completed and emits ProjectCompleted only on the final milestone", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      const { escrow, developer } = project;

      await expect(approveAndExecuteMilestone(project, 0n)).to.not.emit(escrow, "ProjectCompleted");
      expect(await escrow.completed()).to.equal(false);

      await escrow.connect(developer).startMilestone(1);
      await expect(approveAndExecuteMilestone(project, 1n)).to.emit(escrow, "ProjectCompleted");
      expect(await escrow.completed()).to.equal(true);
    });

    it("never reports a vote lock on a completed project", async function () {
      const { escrow, alice } = await networkHelpers.loadFixture(launchAndCompleteProject);

      expect(await escrow.isUserVoteLocked(alice.address)).to.equal(false);
    });
  });
});
