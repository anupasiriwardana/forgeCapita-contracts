import { expect } from "chai";
import {
  DAY,
  ONE_TOKEN,
  PUBLIC_SUPPLY,
  ethers,
  etherDelta,
  launchAndClaimProject,
  launchAndFundProject,
  launchAndStartMilestoneProject,
  networkHelpers,
  sendEth,
} from "./helpers/protocol.js";
import { approveAndExecute, eth } from "./helpers/extra.js";

const { time } = networkHelpers;
const NOT_APPROVED = "Milestone approval conditions not met";

/** Edge cases for CON-03.4 that the audit of the existing suites found uncovered. */
describe("Regression: edge cases of unchanged behaviour", function () {
  describe("funding close with surplus and uneven deposits", function () {
    it("takes 5% of everything raised when the goal is exceeded", async function () {
      const project = await networkHelpers.loadFixture(launchAndFundProject);
      const { escrow, developer, outsider } = project;
      await sendEth(outsider, await escrow.getAddress(), eth("2"));

      const delta = await etherDelta(project.treasury.address, () =>
        escrow.connect(developer).closeFundingAndStart(),
      );

      expect(delta).to.equal(eth("0.6"));
      expect(await escrow.totalRaised()).to.equal(eth("12"));
      expect(await escrow.netFunds()).to.equal(eth("11.4"));
    });

    it("floors each claim, never over-allocates the public supply and leaves only dust", async function () {
      const project = await networkHelpers.loadFixture(launchAndFundProject);
      const { escrow, token, developer, alice, bob, carol, outsider } = project;
      await sendEth(outsider, await escrow.getAddress(), 7n);
      await escrow.connect(developer).closeFundingAndStart();
      const totalRaised = await escrow.totalRaised();

      let claimed = 0n;
      for (const backer of [alice, bob, carol, outsider]) {
        const deposit = await escrow.deposits(backer.address);
        await escrow.connect(backer).claimTokens();
        const received = await token.balanceOf(backer.address);
        expect(received).to.equal((deposit * PUBLIC_SUPPLY) / totalRaised);
        claimed += received;
      }

      expect(claimed <= PUBLIC_SUPPLY).to.equal(true);
      expect(PUBLIC_SUPPLY - claimed < 4n).to.equal(true);
    });
  });

  describe("two-step developer change", function () {
    it("leaves the old developer in charge until the successor accepts", async function () {
      const { escrow, developer, outsider } = await networkHelpers.loadFixture(
        launchAndClaimProject,
      );
      await escrow.connect(developer).proposeNewDeveloper(outsider.address);

      expect(await escrow.developer()).to.equal(developer.address);
      await expect(escrow.connect(outsider).startMilestone(0)).to.be.revertedWith(
        "Only developer can request",
      );
      await escrow.connect(developer).startMilestone(0);
    });

    it("moves every developer right, and the payout, to the successor", async function () {
      const project = await networkHelpers.loadFixture(launchAndClaimProject);
      const { escrow, developer, outsider } = project;
      await escrow.connect(developer).proposeNewDeveloper(outsider.address);
      await escrow.connect(outsider).acceptDeveloperRole();

      await expect(escrow.connect(developer).startMilestone(0)).to.be.revertedWith(
        "Only developer can request",
      );
      await expect(escrow.connect(developer).cancelProject("x")).to.be.revertedWith(
        "Only developer or Guardian can cancel",
      );
      await expect(escrow.connect(outsider).acceptDeveloperRole()).to.be.revertedWith(
        "Only pending developer can accept",
      );
      await escrow.connect(outsider).startMilestone(0);
      const distributorAddress = await project.distributor.getAddress();
      for (const backer of [project.alice, project.bob]) {
        const balance = await project.token.balanceOf(backer.address);
        await project.token.connect(backer).approve(distributorAddress, balance);
        await project.distributor.connect(backer).stake(balance);
      }

      const newDeveloperDelta = await etherDelta(outsider.address, () => approveAndExecute(project));

      expect(newDeveloperDelta).to.equal(eth("3.8"));
    });

    it("lets a later proposal replace a pending one, which then cannot accept", async function () {
      const { escrow, developer, treasury, alice, outsider } = await networkHelpers.loadFixture(
        launchAndClaimProject,
      );
      await escrow.connect(developer).proposeNewDeveloper(outsider.address);
      await escrow.connect(treasury).proposeNewDeveloper(alice.address);

      await expect(escrow.connect(outsider).acceptDeveloperRole()).to.be.revertedWith(
        "Only pending developer can accept",
      );
      await escrow.connect(alice).acceptDeveloperRole();
      expect(await escrow.developer()).to.equal(alice.address);
    });
  });

  describe("fast-track and quorum boundaries", function () {
    // alice 320, bob 240, carol 240 staked; public supply 800, half = 400, 20% quorum = 160
    it("does not fast-track at exactly 50% of the public supply, but does one wei above", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      const { escrow, distributor, alice, carol } = project;
      await distributor.connect(carol).withdraw(160n * ONE_TOKEN);
      await escrow.connect(alice).vote(true);
      await escrow.connect(carol).vote(true);

      expect((await escrow.milestones(0n)).yesVotes).to.equal(400n * ONE_TOKEN);
      await expect(escrow.executeMilestone()).to.be.revertedWith(NOT_APPROVED);
    });

    it("fast-tracks as soon as yes votes exceed 50%", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      const { escrow, distributor, alice, carol } = project;
      await distributor.connect(carol).withdraw(160n * ONE_TOKEN - 1n);
      await escrow.connect(alice).vote(true);
      await escrow.connect(carol).vote(true);

      await expect(escrow.executeMilestone()).to.emit(escrow, "MilestoneExecuted");
    });

    it("lets exactly 50% pass through the quorum path once 28 days are over", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      const { escrow, distributor, alice, carol } = project;
      await distributor.connect(carol).withdraw(160n * ONE_TOKEN);
      await escrow.connect(alice).vote(true);
      await escrow.connect(carol).vote(true);
      await time.increase(28 * DAY);

      await expect(escrow.executeMilestone()).to.emit(escrow, "MilestoneExecuted");
    });

    it("accepts a turnout of exactly 20% after 28 days", async function () {
      const exact = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      await exact.distributor.connect(exact.alice).withdraw(160n * ONE_TOKEN);
      await exact.escrow.connect(exact.alice).vote(true);
      await time.increase(28 * DAY);
      await expect(exact.escrow.executeMilestone()).to.emit(exact.escrow, "MilestoneExecuted");
    });

    it("rejects a turnout one wei below 20% even after 28 days", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      await project.distributor.connect(project.alice).withdraw(160n * ONE_TOKEN + 1n);
      await project.escrow.connect(project.alice).vote(true);
      await time.increase(28 * DAY);

      await expect(project.escrow.executeMilestone()).to.be.revertedWith(NOT_APPROVED);
    });

    it("rejects a tie between yes and no after 28 days", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      await project.distributor.connect(project.alice).withdraw(80n * ONE_TOKEN);
      await project.escrow.connect(project.alice).vote(true);
      await project.escrow.connect(project.bob).vote(false);
      await time.increase(28 * DAY);

      await expect(project.escrow.executeMilestone()).to.be.revertedWith(NOT_APPROVED);
    });

    it("opens the quorum path exactly 28 days after voting started, not a second earlier", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      const { escrow, alice, bob } = project;
      await escrow.connect(alice).vote(true);
      await escrow.connect(bob).vote(false);
      const started = (await escrow.milestones(0n)).votingStartTime;

      await time.increaseTo(started + BigInt(28 * DAY) - 2n);
      await expect(escrow.executeMilestone()).to.be.revertedWith(NOT_APPROVED);

      await time.setNextBlockTimestamp(started + BigInt(28 * DAY));
      await expect(escrow.executeMilestone()).to.emit(escrow, "MilestoneExecuted");
    });

    it("bars a developer who took over the role from voting", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      const { escrow, developer, alice } = project;
      await escrow.connect(developer).proposeNewDeveloper(alice.address);
      await escrow.connect(alice).acceptDeveloperRole();

      await expect(escrow.connect(alice).vote(true)).to.be.revertedWith("Developer cannot vote");
    });
  });

  describe("vote lock across milestones", function () {
    it("locks a voter per milestone: free before voting again, locked after, free once executed", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      const { escrow, distributor, developer, alice, bob, carol } = project;
      await approveAndExecute(project);
      expect(await escrow.isUserVoteLocked(alice.address)).to.equal(false);

      await escrow.connect(developer).startMilestone(1);
      expect(await escrow.isUserVoteLocked(alice.address)).to.equal(false);
      await distributor.connect(alice).withdraw(1n);

      await escrow.connect(alice).vote(true);
      expect(await escrow.isUserVoteLocked(alice.address)).to.equal(true);
      expect(await escrow.isUserVoteLocked(carol.address)).to.equal(false);
      await expect(distributor.connect(alice).withdraw(1n)).to.be.revertedWith(
        "Tokens locked in active milestone vote",
      );

      await escrow.connect(bob).vote(true);
      await escrow.executeMilestone();
      expect(await escrow.isUserVoteLocked(alice.address)).to.equal(false);
    });

    it("releases a vote lock when the project is cancelled", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      const { escrow, distributor, developer, alice } = project;
      await escrow.connect(alice).vote(true);
      await escrow.connect(developer).cancelProject("stop");

      expect(await escrow.isUserVoteLocked(alice.address)).to.equal(false);
      await distributor.connect(alice).withdraw(1n);
    });
  });

  describe("refund after partial progress", function () {
    it("refunds holders pro-rata from what is left after a milestone paid out", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      const { escrow, token, distributor, developer, alice, bob } = project;
      await approveAndExecute(project);
      await escrow.connect(developer).cancelProject("stop");
      for (const backer of [alice, bob]) {
        await distributor
          .connect(backer)
          .withdraw(await distributor.stakedBalance(backer.address));
        await token.connect(backer).approve(await escrow.getAddress(), 1000n * ONE_TOKEN);
      }

      // 5.7 ETH left over 800 public tokens
      expect(await etherDelta(alice.address, () => escrow.connect(alice).refundDeadProject())).to.equal(
        eth("2.28"),
      );
      expect(await etherDelta(bob.address, () => escrow.connect(bob).refundDeadProject())).to.equal(
        eth("1.71"),
      );
    });
  });

  describe("revenue router rounding", function () {
    it("conserves every wei at 24/1/75, with and without stakers", async function () {
      const staked = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      for (const amount of [1n, 99n, 101n, 12_345_678_901n]) {
        const fee = amount / 100n;
        const creator = (amount * 24n) / 100n;
        const investors = amount - creator - fee;
        await expect(staked.router.connect(staked.outsider).routePayment({ value: amount }))
          .to.emit(staked.router, "PaymentReceived")
          .withArgs(staked.outsider.address, amount, creator, investors, fee);
      }
      const routerBalance = await ethers.provider.getBalance(await staked.router.getAddress());
      expect(routerBalance).to.equal(
        (await staked.router.creatorPendingFunds()) + (await staked.router.treasuryPendingFunds()),
      );

      const empty = await networkHelpers.loadFixture(launchAndClaimProject);
      await empty.router.connect(empty.outsider).routePayment({ value: 101n });
      expect(await empty.router.treasuryPendingFunds()).to.equal(1n);
      expect(await empty.router.creatorPendingFunds()).to.equal(100n);
      expect(await ethers.provider.getBalance(await empty.router.getAddress())).to.equal(101n);
    });
  });

  describe("P2P exchange fee rounding", function () {
    it("charges no fee on a price below 100 wei and rounds the fee down otherwise", async function () {
      const project = await networkHelpers.loadFixture(launchAndClaimProject);
      const { token, p2p, treasury, alice, bob } = project;
      await token.connect(alice).approve(await p2p.getAddress(), 3n * ONE_TOKEN);
      const tokenAddress = await token.getAddress();
      await p2p.connect(alice).createListing(tokenAddress, ONE_TOKEN, 99n);
      await p2p.connect(alice).createListing(tokenAddress, ONE_TOKEN, 199n);

      expect(await etherDelta(treasury.address, () => p2p.connect(bob).fillListing(0, { value: 99n }))).to.equal(0n);
      expect(await etherDelta(treasury.address, () => p2p.connect(bob).fillListing(1, { value: 199n }))).to.equal(1n);
      expect(await ethers.provider.getBalance(await p2p.getAddress())).to.equal(0n);
      expect(await token.balanceOf(await p2p.getAddress())).to.equal(0n);
    });
  });
});
