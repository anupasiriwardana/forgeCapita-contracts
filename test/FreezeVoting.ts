import { expect } from "chai";
import {
  DAY,
  approveAndExecuteMilestone,
  approveCurrentMilestone,
  launchAndClaimProject,
  launchAndStartMilestoneProject,
  networkHelpers,
} from "./helpers/protocol.js";

const { time } = networkHelpers;
const PERIOD = BigInt(28 * DAY);
const D = BigInt(DAY);
const NOT_APPROVED = "Milestone approval conditions not met";

describe("CON-02.32 freeze extends voting", function () {
  it("starts with the plain 28 day period", async function () {
    const { escrow } = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
    const [, , , , , , start] = await escrow.milestones(0);

    expect(await escrow.votingEndTime(0)).to.equal(start + PERIOD);
    expect(await escrow.frozenAtVoteStart(0)).to.equal(0n);
  });

  it("rejects the view for a milestone that never started or does not exist", async function () {
    const { escrow } = await networkHelpers.loadFixture(launchAndStartMilestoneProject);

    await expect(escrow.votingEndTime(1)).to.be.revertedWith("Voting not started");
    await expect(escrow.votingEndTime(2)).to.be.revertedWith("Invalid milestone index");
  });

  describe("a freeze during the vote", function () {
    it("does not cancel at day 28 while frozen time covers it, and voting still works", async function () {
      const { escrow, treasury, alice } = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      await time.increase(10n * D);
      await escrow.connect(treasury).freezeMilestones();
      await time.increase(PERIOD - 10n * D + 1n);
      expect(await escrow.isFrozen()).to.equal(true);

      await expect(escrow.executeMilestone()).to.be.revertedWith(NOT_APPROVED);
      expect(await escrow.projectCancelled()).to.equal(false);
      await expect(escrow.connect(alice).vote(true)).to.emit(escrow, "Voted");
    });

    it("fails the vote at the extended end, exclusive boundary, view equals enforcement", async function () {
      const { escrow, treasury, alice, bob } = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      const [, , , , , , start] = await escrow.milestones(0);
      await time.increase(10n * D);
      await escrow.connect(treasury).freezeMilestones();
      await time.increase(10n * D);
      await escrow.connect(treasury).unfreezeMilestones();
      const end = await escrow.votingEndTime(0);
      expect(end).to.equal(start + PERIOD + (await escrow.totalFrozen()));
      expect(await escrow.totalFrozen()).to.be.greaterThanOrEqual(10n * D);

      await time.setNextBlockTimestamp(end - 1n);
      await expect(escrow.connect(alice).vote(false)).to.emit(escrow, "Voted");
      await time.setNextBlockTimestamp(end);
      await expect(escrow.connect(bob).vote(true)).to.be.revertedWith("Voting period ended");
      await expect(escrow.executeMilestone()).to.emit(escrow, "MilestoneFailed").withArgs(0n);
      expect(await escrow.projectCancelled()).to.equal(true);
    });

    it("keeps the end moving while the freeze runs and fixes it after a lapse", async function () {
      const { escrow, treasury } = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      const [, , , , , , start] = await escrow.milestones(0);
      await escrow.connect(treasury).freezeMilestones();
      const frozenAt = BigInt(await time.latest());
      await time.increase(5n * D);
      expect(await escrow.votingEndTime(0)).to.equal(start + PERIOD + (BigInt(await time.latest()) - frozenAt));

      await time.increase(60n * D);
      expect(await escrow.isFrozen()).to.equal(false);
      expect(await escrow.votingEndTime(0)).to.equal(start + PERIOD + 45n * D);
    });

    it("is not double counted after an early unfreeze followed by another freeze", async function () {
      const { escrow, treasury } = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      const [, , , , , , start] = await escrow.milestones(0);
      await escrow.connect(treasury).freezeMilestones();
      await time.increase(10n * D);
      await escrow.connect(treasury).unfreezeMilestones();
      const settled = await escrow.totalFrozen();
      expect(await escrow.votingEndTime(0)).to.equal(start + PERIOD + settled);

      await time.increase(3n * D);
      expect(await escrow.votingEndTime(0)).to.equal(start + PERIOD + settled);

      await escrow.connect(treasury).freezeMilestones();
      await time.increase(100n * D);
      expect(await escrow.votingEndTime(0)).to.equal(start + PERIOD + settled + 45n * D);
    });

    it("is bounded by the 90 day cap across two freezes", async function () {
      const { escrow, treasury } = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      const [, , , , , , start] = await escrow.milestones(0);
      await escrow.connect(treasury).freezeMilestones();
      await time.increase(50n * D);
      await escrow.connect(treasury).freezeMilestones();
      await time.increase(50n * D);
      await expect(escrow.connect(treasury).freezeMilestones()).to.be.revertedWith("Freeze limit reached");

      expect(await escrow.votingEndTime(0)).to.equal(start + PERIOD + 90n * D);
    });

    it("still blocks the payout of a passing vote while frozen", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      const { escrow, treasury } = project;
      await approveCurrentMilestone(project);
      await escrow.connect(treasury).freezeMilestones();

      await expect(escrow.executeMilestone()).to.be.revertedWith("Milestones frozen");

      await escrow.connect(treasury).unfreezeMilestones();
      await expect(escrow.executeMilestone()).to.emit(escrow, "MilestoneExecuted");
    });

    it("lets the failure path run when the vote ended before the freeze began", async function () {
      const { escrow, treasury } = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      await time.increase(PERIOD + D);
      await escrow.connect(treasury).freezeMilestones();

      await expect(escrow.executeMilestone()).to.emit(escrow, "MilestoneFailed");
    });
  });

  describe("a freeze before the vote starts", function () {
    it("does not extend the vote when the freeze ended before the start", async function () {
      const { escrow, treasury, developer } = await networkHelpers.loadFixture(launchAndClaimProject);
      await escrow.connect(treasury).freezeMilestones();
      await time.increase(5n * D);
      await escrow.connect(treasury).unfreezeMilestones();
      await escrow.connect(developer).startMilestone(0);
      const [, , , , , , start] = await escrow.milestones(0);

      expect(await escrow.votingEndTime(0)).to.equal(start + PERIOD);
      expect(await escrow.frozenAtVoteStart(0)).to.equal(await escrow.totalFrozen());
      await time.setNextBlockTimestamp(start + PERIOD);
      await expect(escrow.executeMilestone()).to.emit(escrow, "MilestoneFailed");
    });

    it("does not extend the vote when the freeze lapsed before the start", async function () {
      const { escrow, treasury, developer } = await networkHelpers.loadFixture(launchAndClaimProject);
      await escrow.connect(treasury).freezeMilestones();
      await time.increase(50n * D);
      await escrow.connect(developer).startMilestone(0);
      const [, , , , , , start] = await escrow.milestones(0);

      expect(await escrow.frozenAtVoteStart(0)).to.equal(45n * D);
      expect(await escrow.votingEndTime(0)).to.equal(start + PERIOD);
    });

    it("extends only by the part after the start when the freeze spans it", async function () {
      const { escrow, treasury, developer } = await networkHelpers.loadFixture(launchAndClaimProject);
      await escrow.connect(treasury).freezeMilestones();
      await time.increase(10n * D);
      await escrow.connect(developer).startMilestone(0);
      const [, , , , , , start] = await escrow.milestones(0);
      await time.increase(15n * D);
      await escrow.connect(treasury).unfreezeMilestones();

      expect(await escrow.totalFrozen()).to.be.greaterThan(25n * D - 5n);
      const extension = (await escrow.votingEndTime(0)) - start - PERIOD;
      expect(extension).to.be.greaterThan(15n * D - 5n);
      expect(extension).to.be.lessThan(15n * D + 5n);
    });
  });

  describe("later milestones", function () {
    it("does not inherit the frozen time of milestone 1", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      const { escrow, treasury, developer } = project;
      await approveCurrentMilestone(project);
      await escrow.connect(treasury).freezeMilestones();
      await time.increase(10n * D);
      await escrow.connect(treasury).unfreezeMilestones();
      const frozen = await escrow.totalFrozen();
      await escrow.executeMilestone();

      await escrow.connect(developer).startMilestone(1);
      const [, , , , , , start] = await escrow.milestones(1);
      expect(await escrow.frozenAtVoteStart(1)).to.equal(frozen);
      expect(await escrow.votingEndTime(1)).to.equal(start + PERIOD);
    });

    it("extends milestone 2 only by a freeze that happens during its own vote", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      const { escrow, treasury, developer } = project;
      await approveAndExecuteMilestone(project);
      await escrow.connect(developer).startMilestone(1);
      const [, , , , , , start] = await escrow.milestones(1);
      await escrow.connect(treasury).freezeMilestones();
      await time.increase(4n * D);
      await escrow.connect(treasury).unfreezeMilestones();

      expect(await escrow.votingEndTime(1)).to.equal(start + PERIOD + (await escrow.totalFrozen()));
    });
  });
});
