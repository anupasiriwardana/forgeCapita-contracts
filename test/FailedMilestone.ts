import { expect } from "chai";
import {
  DAY,
  ONE_TOKEN,
  ethers,
  etherDelta,
  launchAndClaimProject,
  launchAndStartMilestoneProject,
  networkHelpers,
} from "./helpers/protocol.js";
import {
  type Project,
  claimStakeAndStart,
  enableRelayer,
  eth,
  futureDeadline,
  launchClosedWithMilestones,
  setCap,
  signVote,
} from "./helpers/extra.js";

const { time } = networkHelpers;
const VOTING_PERIOD = BigInt(28 * DAY);
const NOT_APPROVED = "Milestone approval conditions not met";

/** Alice (320 of 800) votes no on milestone 0, so nothing can pass. */
async function failingVote(project: Project): Promise<bigint> {
  await project.escrow.connect(project.alice).vote(false);
  return (await project.escrow.milestones(0n)).votingStartTime;
}

/** Closed project with a relayer, two relayed claims (gas spent exactly at the ceiling), voting open. */
async function atCeilingWithOpenVote(): Promise<Project> {
  const project = await launchClosedWithMilestones([40n, 60n]);
  await enableRelayer(project);
  await setCap(project, eth("0.9625"));
  await project.escrow.connect(project.outsider).claimTokensFor(project.alice.address);
  await project.escrow.connect(project.outsider).claimTokensFor(project.bob.address);
  await claimStakeAndStart(project);
  return project;
}

/** Same as above but with a cap that makes the relayer's cost non-zero and well below the ceiling. */
async function relayerWithOpenVote(): Promise<Project> {
  const project = await launchClosedWithMilestones([40n, 60n]);
  await enableRelayer(project);
  await setCap(project, eth("0.1"));
  await claimStakeAndStart(project);
  return project;
}

describe("Failed milestone vote (CON-02.24, 02.25, 02.26 dropped)", function () {
  describe("executeMilestone after the voting period", function () {
    it("cancels the project and emits MilestoneFailed when nobody reaches quorum", async function () {
      const { escrow } = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      await time.increase(VOTING_PERIOD);
      const before = await time.latest();

      await expect(escrow.executeMilestone()).to.emit(escrow, "MilestoneFailed").withArgs(0n);

      expect(await escrow.projectCancelled()).to.equal(true);
      expect(await escrow.cancelledAt()).to.be.greaterThan(BigInt(before));
      const milestone = await escrow.milestones(0n);
      expect(milestone.isExecuted).to.equal(false);
      expect(await escrow.currentMilestoneIndex()).to.equal(0n);
    });

    it("cancels when no outweighs yes with quorum", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      await project.escrow.connect(project.alice).vote(false);
      await project.escrow.connect(project.bob).vote(true);
      await time.increase(VOTING_PERIOD);

      await expect(project.escrow.executeMilestone()).to.emit(project.escrow, "MilestoneFailed");
    });

    it("pays nobody on the failure path", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      const { escrow, developer } = project;
      await failingVote(project);
      await time.increase(VOTING_PERIOD);
      const escrowAddress = await escrow.getAddress();
      const before = await ethers.provider.getBalance(escrowAddress);

      const devDelta = await etherDelta(developer.address, () => escrow.executeMilestone());

      expect(devDelta).to.equal(0n);
      expect(await ethers.provider.getBalance(escrowAddress)).to.equal(before);
      expect(await escrow.completed()).to.equal(false);
    });

    it("reverts while voting is open and undecided, up to the last second", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      const { escrow } = project;
      const started = await failingVote(project);

      await expect(escrow.executeMilestone()).to.be.revertedWith(NOT_APPROVED);
      await time.increaseTo(started + VOTING_PERIOD - 2n);
      await expect(escrow.executeMilestone()).to.be.revertedWith(NOT_APPROVED);
      expect(await escrow.projectCancelled()).to.equal(false);

      await time.setNextBlockTimestamp(started + VOTING_PERIOD);
      await expect(escrow.executeMilestone()).to.emit(escrow, "MilestoneFailed");
    });

    it("still pays an approved milestone before the end (fast track)", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      await project.escrow.connect(project.alice).vote(true);
      await project.escrow.connect(project.bob).vote(true);

      await expect(project.escrow.executeMilestone()).to.emit(project.escrow, "MilestoneExecuted");
      expect(await project.escrow.projectCancelled()).to.equal(false);
    });

    it("still pays a fast-track pass after the voting period has ended", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      await project.escrow.connect(project.alice).vote(true);
      await project.escrow.connect(project.bob).vote(true);
      await time.increase(VOTING_PERIOD + 1n);

      await expect(project.escrow.executeMilestone()).to.emit(project.escrow, "MilestoneExecuted");
      expect(await project.escrow.projectCancelled()).to.equal(false);
      expect(await project.escrow.cancelledAt()).to.equal(0n);
    });

    it("closes everything after the failure: no second execute, no vote, no start", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      const { escrow, developer, bob } = project;
      await time.increase(VOTING_PERIOD);
      await escrow.executeMilestone();

      await expect(escrow.executeMilestone()).to.be.revertedWith("Project cancelled");
      await expect(escrow.connect(bob).vote(true)).to.be.revertedWith("Project has been cancelled");
      await expect(escrow.connect(developer).startMilestone(0n)).to.be.revertedWith("Project cancelled");
    });

    it("keeps working on the second milestone and cancels with its index", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      const { escrow, developer, alice, bob } = project;
      await escrow.connect(alice).vote(true);
      await escrow.connect(bob).vote(true);
      await escrow.executeMilestone();
      await escrow.connect(developer).startMilestone(1n);
      await time.increase(VOTING_PERIOD);

      await expect(escrow.executeMilestone()).to.emit(escrow, "MilestoneFailed").withArgs(1n);
      expect(await escrow.projectCancelled()).to.equal(true);
    });
  });

  describe("refunds after a failed finalisation", function () {
    it("refunds pro-rata from what is left and the developer keeps the earlier payout", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      const { escrow, token, distributor, developer, alice, bob, carol } = project;
      await escrow.connect(alice).vote(true);
      await escrow.connect(bob).vote(true);
      const devPaid = await etherDelta(developer.address, () => escrow.executeMilestone());
      expect(devPaid).to.equal(eth("3.8"));

      await escrow.connect(developer).startMilestone(1n);
      await escrow.connect(alice).vote(false);
      await time.increase(VOTING_PERIOD);
      await escrow.executeMilestone();

      const escrowAddress = await escrow.getAddress();
      const left = eth("5.7");
      let remaining = 800n * ONE_TOKEN;
      let balance = left;
      for (const [backer, tokens] of [
        [alice, 320n],
        [bob, 240n],
        [carol, 240n],
      ] as const) {
        await distributor.connect(backer).withdraw(tokens * ONE_TOKEN);
        const expected = (tokens * ONE_TOKEN * balance) / remaining;
        await token.connect(backer).approve(escrowAddress, tokens * ONE_TOKEN);
        const delta = await etherDelta(backer.address, () => escrow.connect(backer).refundDeadProject());
        expect(delta).to.equal(expected);
        remaining -= tokens * ONE_TOKEN;
        balance -= expected;
      }
      expect(await escrow.remainingPublicTokens()).to.equal(0n);
    });
  });

  describe("voting end (CON-02.25)", function () {
    it("lets vote through in the last second and rejects it from the end on", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      const { escrow, alice, bob } = project;
      const started = (await escrow.milestones(0n)).votingStartTime;

      await time.setNextBlockTimestamp(started + VOTING_PERIOD - 1n);
      await escrow.connect(alice).vote(true);
      expect(await escrow.hasVoted(0n, alice.address)).to.equal(true);

      await time.setNextBlockTimestamp(started + VOTING_PERIOD);
      await expect(escrow.connect(bob).vote(true)).to.be.revertedWith("Voting period ended");
      expect(await escrow.hasVoted(0n, bob.address)).to.equal(false);
    });

    it("lets voteBySig through in the last second and rejects it from the end on", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      const { escrow, alice, bob, outsider } = project;
      const started = (await escrow.milestones(0n)).votingStartTime;
      const deadline = await futureDeadline(60n * BigInt(DAY));
      const aliceSig = await signVote(project, alice, true, deadline, 0n);
      const bobSig = await signVote(project, bob, true, deadline, 0n);

      await time.setNextBlockTimestamp(started + VOTING_PERIOD - 1n);
      await escrow.connect(outsider).voteBySig(alice.address, true, deadline, aliceSig);
      expect(await escrow.hasVoted(0n, alice.address)).to.equal(true);

      await time.setNextBlockTimestamp(started + VOTING_PERIOD);
      await expect(
        escrow.connect(outsider).voteBySig(bob.address, true, deadline, bobSig),
      ).to.be.revertedWith("Voting period ended");
    });

    it("has no extendVoting, VotingExtended or MAX_VOTING_EXTENSION (CON-02.26 dropped)", async function () {
      const { escrow } = await networkHelpers.loadFixture(launchAndStartMilestoneProject);

      expect(escrow.interface.getFunction("extendVoting")).to.equal(null);
      expect(escrow.interface.getEvent("VotingExtended")).to.equal(null);
      expect(escrow.interface.getFunction("MAX_VOTING_EXTENSION")).to.equal(null);
      expect(await escrow.VOTING_PERIOD()).to.equal(VOTING_PERIOD);
    });
  });

  describe("freeze interplay", function () {
    it("lets the failure path run while frozen", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      const { escrow, treasury } = project;
      await time.increase(VOTING_PERIOD + 86_400n);
      await escrow.connect(treasury).freezeMilestones();
      expect(await escrow.isFrozen()).to.equal(true);

      await expect(escrow.executeMilestone()).to.emit(escrow, "MilestoneFailed");
      expect(await escrow.projectCancelled()).to.equal(true);
    });

    it("keeps blocking the payout path while frozen", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      const { escrow, treasury } = project;
      await escrow.connect(project.alice).vote(true);
      await escrow.connect(project.bob).vote(true);
      await escrow.connect(treasury).freezeMilestones();

      await expect(escrow.executeMilestone()).to.be.revertedWith("Milestones frozen");
    });

    it("keeps an undecided open vote reverting with the approval message while frozen", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      await project.escrow.connect(project.treasury).freezeMilestones();

      await expect(project.escrow.executeMilestone()).to.be.revertedWith(NOT_APPROVED);
    });
  });

  describe("gas ledger", function () {
    it("books no gas on the failure path when a relayer submits it", async function () {
      const project = await networkHelpers.loadFixture(relayerWithOpenVote);
      const { escrow, outsider } = project;
      await escrow.connect(project.alice).vote(false);
      await time.increase(VOTING_PERIOD);
      const spentBefore = await escrow.gasSpent();

      const tx = await escrow.connect(outsider).executeMilestone();

      await expect(tx).to.emit(escrow, "MilestoneFailed");
      await expect(tx).to.not.emit(escrow, "SponsoredGas");
      expect(await escrow.gasSpent()).to.equal(spentBefore);
    });

    it("still cancels when a relayer submits the failed finalisation at the reached ceiling", async function () {
      const project = await networkHelpers.loadFixture(atCeilingWithOpenVote);
      const { escrow, outsider } = project;
      expect(await escrow.gasSpent()).to.equal(eth("1.925"));
      await escrow.connect(project.alice).vote(false);
      await time.increase(VOTING_PERIOD);

      await expect(escrow.connect(outsider).executeMilestone()).to.emit(escrow, "MilestoneFailed");

      expect(await escrow.projectCancelled()).to.equal(true);
      expect(await escrow.gasSpent()).to.equal(eth("1.925"));
    });

    it("still books gas on the payout path", async function () {
      const project = await networkHelpers.loadFixture(relayerWithOpenVote);
      const { escrow, outsider } = project;
      await escrow.connect(project.alice).vote(true);
      await escrow.connect(project.bob).vote(true);
      const spentBefore = await escrow.gasSpent();

      const tx = await escrow.connect(outsider).executeMilestone();

      await expect(tx).to.emit(escrow, "SponsoredGas");
      await expect(tx).to.emit(escrow, "MilestoneExecuted");
      expect(await escrow.gasSpent()).to.be.greaterThan(spentBefore);
    });
  });

  describe("unrelated state", function () {
    it("does not cancel a project whose voting is merely open", async function () {
      const { escrow } = await networkHelpers.loadFixture(launchAndClaimProject);

      expect(await escrow.cancelledAt()).to.equal(0n);
      expect(await escrow.projectCancelled()).to.equal(false);
    });
  });
});
