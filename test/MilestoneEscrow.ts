import { expect } from "chai";
import {
  DAY,
  DEVELOPER_SUPPLY,
  ONE_TOKEN,
  approveAndExecuteMilestone,
  ethers,
  etherDelta,
  launchAndClaimProject,
  launchAndCloseProject,
  launchAndCompleteProject,
  launchAndFundProject,
  launchAndStartMilestoneProject,
  launchProject,
  networkHelpers,
  sendEth,
} from "./helpers/protocol.js";

const { time } = networkHelpers;
const eth = ethers.parseEther;

describe("MilestoneEscrow", function () {
  describe("funding", function () {
    it("records a deposit and emits DepositReceived", async function () {
      const { escrow, alice } = await networkHelpers.loadFixture(launchProject);

      await expect(sendEth(alice, await escrow.getAddress(), eth("1")))
        .to.emit(escrow, "DepositReceived")
        .withArgs(alice.address, eth("1"));
      expect(await escrow.deposits(alice.address)).to.equal(eth("1"));
    });

    it("accumulates repeated deposits from the same backer", async function () {
      const { escrow, alice } = await networkHelpers.loadFixture(launchProject);
      await sendEth(alice, await escrow.getAddress(), eth("1"));
      await sendEth(alice, await escrow.getAddress(), eth("2"));

      expect(await escrow.deposits(alice.address)).to.equal(eth("3"));
    });

    it("rejects funding from the developer", async function () {
      const { escrow, developer } = await networkHelpers.loadFixture(launchProject);

      await expect(sendEth(developer, await escrow.getAddress(), eth("1"))).to.be.revertedWith(
        "Developer cannot fund campaign",
      );
    });

    it("rejects funding after the deadline", async function () {
      const { escrow, alice } = await networkHelpers.loadFixture(launchProject);
      await time.increase(31 * DAY);

      await expect(sendEth(alice, await escrow.getAddress(), eth("1"))).to.be.revertedWith(
        "Funding deadline has passed",
      );
    });

    it("rejects funding after funding is closed", async function () {
      const { escrow, outsider } = await networkHelpers.loadFixture(launchAndCloseProject);

      await expect(sendEth(outsider, await escrow.getAddress(), eth("1"))).to.be.revertedWith(
        "Funding phase is over",
      );
    });
  });

  describe("closeFundingAndStart", function () {
    it("sends the 5% platform fee to the treasury", async function () {
      const { escrow, developer, treasury } =
        await networkHelpers.loadFixture(launchAndFundProject);

      const delta = await etherDelta(treasury.address, () =>
        escrow.connect(developer).closeFundingAndStart(),
      );

      expect(delta).to.equal(eth("0.5"));
    });

    it("emits PlatformFeeCollected and records totalRaised and netFunds", async function () {
      const { escrow, developer } = await networkHelpers.loadFixture(launchAndFundProject);

      await expect(escrow.connect(developer).closeFundingAndStart())
        .to.emit(escrow, "PlatformFeeCollected")
        .withArgs(eth("0.5"));
      expect(await escrow.totalRaised()).to.equal(eth("10"));
      expect(await escrow.netFunds()).to.equal(eth("9.5"));
      expect(await escrow.isFundingActive()).to.equal(false);
    });

    it("reverts when the funding goal is not reached", async function () {
      const { escrow, developer, alice } = await networkHelpers.loadFixture(launchProject);
      await sendEth(alice, await escrow.getAddress(), eth("9"));

      await expect(escrow.connect(developer).closeFundingAndStart()).to.be.revertedWith(
        "Funding goal not reached",
      );
    });

    it("reverts for anyone but the developer", async function () {
      const { escrow, outsider } = await networkHelpers.loadFixture(launchAndFundProject);

      await expect(escrow.connect(outsider).closeFundingAndStart()).to.be.revertedWith(
        "Only developer can call",
      );
    });

    it("reverts when called a second time", async function () {
      const { escrow, developer } = await networkHelpers.loadFixture(launchAndCloseProject);

      await expect(escrow.connect(developer).closeFundingAndStart()).to.be.revertedWith(
        "Already closed",
      );
    });
  });

  describe("claimTokens", function () {
    it("gives each backer a share proportional to the deposit", async function () {
      const { token, alice, bob, carol } = await networkHelpers.loadFixture(launchAndClaimProject);

      expect(await token.balanceOf(alice.address)).to.equal(320n * ONE_TOKEN);
      expect(await token.balanceOf(bob.address)).to.equal(240n * ONE_TOKEN);
      expect(await token.balanceOf(carol.address)).to.equal(240n * ONE_TOKEN);
    });

    it("keeps the developer allocation in the escrow", async function () {
      const { token, escrow } = await networkHelpers.loadFixture(launchAndClaimProject);

      expect(await token.balanceOf(await escrow.getAddress())).to.equal(DEVELOPER_SUPPLY);
    });

    it("reverts on a second claim", async function () {
      const { escrow, alice } = await networkHelpers.loadFixture(launchAndClaimProject);

      await expect(escrow.connect(alice).claimTokens()).to.be.revertedWith(
        "Tokens already claimed",
      );
    });

    it("reverts while funding is still active", async function () {
      const { escrow, alice } = await networkHelpers.loadFixture(launchAndFundProject);

      await expect(escrow.connect(alice).claimTokens()).to.be.revertedWith(
        "Funding phase is still active",
      );
    });

    it("reverts for an address without a deposit", async function () {
      const { escrow, outsider } = await networkHelpers.loadFixture(launchAndCloseProject);

      await expect(escrow.connect(outsider).claimTokens()).to.be.revertedWith(
        "No investment found",
      );
    });
  });

  describe("startMilestone", function () {
    it("opens voting for milestone 0", async function () {
      const { escrow, developer } = await networkHelpers.loadFixture(launchAndClaimProject);

      await expect(escrow.connect(developer).startMilestone(0))
        .to.emit(escrow, "VotingStarted")
        .withArgs(0n);

      const milestone = await escrow.milestones(0);
      expect(milestone.isVotingOpen).to.equal(true);
      expect(milestone.votingStartTime).to.equal(BigInt(await time.latest()));
    });

    it("lets the developer start milestone 0 long after funding closed", async function () {
      const { escrow, developer } = await networkHelpers.loadFixture(launchAndClaimProject);
      await time.increase(200 * DAY);

      await expect(escrow.connect(developer).startMilestone(0)).to.emit(escrow, "VotingStarted");
    });

    it("reverts for anyone but the developer", async function () {
      const { escrow, outsider } = await networkHelpers.loadFixture(launchAndClaimProject);

      await expect(escrow.connect(outsider).startMilestone(0)).to.be.revertedWith(
        "Only developer can request",
      );
    });

    it("reverts while funding is still active", async function () {
      const { escrow, developer } = await networkHelpers.loadFixture(launchAndFundProject);

      await expect(escrow.connect(developer).startMilestone(0)).to.be.revertedWith(
        "Funding still active",
      );
    });

    it("reverts for an index other than the current milestone", async function () {
      const { escrow, developer } = await networkHelpers.loadFixture(launchAndClaimProject);

      await expect(escrow.connect(developer).startMilestone(1)).to.be.revertedWith(
        "Invalid milestone index",
      );
    });

    it("reverts when the milestone is already open", async function () {
      const { escrow, developer } = await networkHelpers.loadFixture(
        launchAndStartMilestoneProject,
      );

      await expect(escrow.connect(developer).startMilestone(0)).to.be.revertedWith(
        "Milestone already open",
      );
    });

    it("reverts on a cancelled project", async function () {
      const { escrow, developer } = await networkHelpers.loadFixture(launchAndClaimProject);
      await escrow.connect(developer).cancelProject("stop");

      await expect(escrow.connect(developer).startMilestone(0)).to.be.revertedWith(
        "Project cancelled",
      );
    });
  });

  describe("vote", function () {
    it("counts the staked balance as weight and emits Voted", async function () {
      const { escrow, alice } = await networkHelpers.loadFixture(launchAndStartMilestoneProject);

      await expect(escrow.connect(alice).vote(true))
        .to.emit(escrow, "Voted")
        .withArgs(alice.address, 0n, true, 320n * ONE_TOKEN);
      expect((await escrow.milestones(0)).yesVotes).to.equal(320n * ONE_TOKEN);
    });

    it("counts a no vote separately", async function () {
      const { escrow, bob } = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      await escrow.connect(bob).vote(false);

      const milestone = await escrow.milestones(0);
      expect(milestone.noVotes).to.equal(240n * ONE_TOKEN);
      expect(milestone.yesVotes).to.equal(0n);
    });

    it("reverts for an address without staked tokens", async function () {
      const { escrow, outsider } = await networkHelpers.loadFixture(
        launchAndStartMilestoneProject,
      );

      await expect(escrow.connect(outsider).vote(true)).to.be.revertedWith(
        "No voting power (must stake tokens first)",
      );
    });

    it("reverts for the developer", async function () {
      const { escrow, developer } = await networkHelpers.loadFixture(
        launchAndStartMilestoneProject,
      );

      await expect(escrow.connect(developer).vote(true)).to.be.revertedWith(
        "Developer cannot vote",
      );
    });

    it("reverts on a second vote for the same milestone", async function () {
      const { escrow, alice } = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      await escrow.connect(alice).vote(true);

      await expect(escrow.connect(alice).vote(false)).to.be.revertedWith("Already voted");
    });

    it("reverts while voting is not open", async function () {
      const { escrow, alice } = await networkHelpers.loadFixture(launchAndClaimProject);

      await expect(escrow.connect(alice).vote(true)).to.be.revertedWith("Voting is not open");
    });

    it("reverts while funding is still active", async function () {
      const { escrow, alice } = await networkHelpers.loadFixture(launchAndFundProject);

      await expect(escrow.connect(alice).vote(true)).to.be.revertedWith(
        "Funding is still active",
      );
    });

    it("reverts on a cancelled project", async function () {
      const { escrow, developer, alice } = await networkHelpers.loadFixture(
        launchAndStartMilestoneProject,
      );
      await escrow.connect(developer).cancelProject("stop");

      await expect(escrow.connect(alice).vote(true)).to.be.revertedWith(
        "Project has been cancelled",
      );
    });

    it("locks the voter's staked tokens until the vote is over", async function () {
      const { escrow, distributor, alice } = await networkHelpers.loadFixture(
        launchAndStartMilestoneProject,
      );
      await escrow.connect(alice).vote(true);

      expect(await escrow.isUserVoteLocked(alice.address)).to.equal(true);
      await expect(distributor.connect(alice).withdraw(1n)).to.be.revertedWith(
        "Tokens locked in active milestone vote",
      );
    });

    it("lets a staker who has not voted withdraw", async function () {
      const { distributor, bob } = await networkHelpers.loadFixture(
        launchAndStartMilestoneProject,
      );

      await distributor.connect(bob).withdraw(1n);

      expect(await distributor.stakedBalance(bob.address)).to.equal(240n * ONE_TOKEN - 1n);
    });

    it("keeps the vote lock after more than 120 days of inactivity", async function () {
      const { escrow, alice } = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      await escrow.connect(alice).vote(true);
      await time.increase(200 * DAY);

      expect(await escrow.isUserVoteLocked(alice.address)).to.equal(true);
    });

    it("unlocks the voter's tokens once the milestone has executed", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      await approveAndExecuteMilestone(project);

      expect(await project.escrow.isUserVoteLocked(project.alice.address)).to.equal(false);
      await project.distributor.connect(project.alice).withdraw(1n);
    });
  });

  describe("executeMilestone", function () {
    it("releases the milestone share to the developer after a fast-track majority", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);

      const delta = await etherDelta(project.developer.address, () =>
        approveAndExecuteMilestone(project),
      );

      expect(delta).to.equal(eth("3.8"));
    });

    it("emits MilestoneExecuted and advances to the next milestone", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);

      await expect(approveAndExecuteMilestone(project))
        .to.emit(project.escrow, "MilestoneExecuted")
        .withArgs(0n, eth("3.8"), 0n, 0n);
      expect(await project.escrow.currentMilestoneIndex()).to.equal(1n);
      expect((await project.escrow.milestones(0)).isExecuted).to.equal(true);
    });

    it("reverts without enough yes votes before the voting period ends", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      await project.escrow.connect(project.alice).vote(true);

      await expect(project.escrow.executeMilestone()).to.be.revertedWith(
        "Milestone approval conditions not met",
      );
    });

    it("passes through the quorum path after 28 days with 20% turnout and more yes than no", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      await project.escrow.connect(project.alice).vote(true);
      await project.escrow.connect(project.bob).vote(false);
      await time.increase(28 * DAY);

      await expect(project.escrow.executeMilestone()).to.emit(
        project.escrow,
        "MilestoneExecuted",
      );
    });

    it("rejects the quorum path when no outweighs yes", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      await project.escrow.connect(project.alice).vote(false);
      await project.escrow.connect(project.bob).vote(true);
      await time.increase(28 * DAY);

      await expect(project.escrow.executeMilestone())
        .to.emit(project.escrow, "MilestoneFailed")
        .withArgs(0n);
      expect(await project.escrow.projectCancelled()).to.equal(true);
    });

    it("rejects the quorum path when turnout is below 20%", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      await project.distributor.connect(project.carol).withdraw(140n * ONE_TOKEN);
      await project.escrow.connect(project.carol).vote(true);
      await time.increase(28 * DAY);

      await expect(project.escrow.executeMilestone())
        .to.emit(project.escrow, "MilestoneFailed")
        .withArgs(0n);
      expect(await project.escrow.projectCancelled()).to.equal(true);
    });

    it("reverts when voting is not open", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      await approveAndExecuteMilestone(project);

      await expect(project.escrow.executeMilestone()).to.be.revertedWith(
        "Voting is not open",
      );
    });

    it("still executes after more than 120 days of inactivity", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      await project.escrow.connect(project.alice).vote(true);
      await project.escrow.connect(project.bob).vote(true);
      await time.increase(200 * DAY);

      await expect(project.escrow.executeMilestone()).to.emit(
        project.escrow,
        "MilestoneExecuted",
      );
    });

    it("keeps the quorum path reachable when a later milestone starts after 120 days", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      await approveAndExecuteMilestone(project);
      await time.increase(200 * DAY);
      await project.escrow.connect(project.developer).startMilestone(1);
      await project.escrow.connect(project.alice).vote(true);
      await project.escrow.connect(project.bob).vote(false);
      await time.increase(28 * DAY);

      await expect(project.escrow.executeMilestone()).to.emit(
        project.escrow,
        "MilestoneExecuted",
      );
    });

    it("reverts on a cancelled project", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      await project.escrow.connect(project.developer).cancelProject("stop");

      await expect(project.escrow.executeMilestone()).to.be.revertedWith(
        "Project cancelled",
      );
    });

    it("vests the 20% developer tokens on the final milestone", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      await approveAndExecuteMilestone(project);
      await project.escrow.connect(project.developer).startMilestone(1);
      expect(await project.token.balanceOf(project.developer.address)).to.equal(0n);

      await expect(approveAndExecuteMilestone(project))
        .to.emit(project.escrow, "MilestoneExecuted")
        .withArgs(1n, eth("5.7"), DEVELOPER_SUPPLY, 0n);

      expect(await project.token.balanceOf(project.developer.address)).to.equal(DEVELOPER_SUPPLY);
    });

    it("drains the escrow once every milestone is executed", async function () {
      const project = await networkHelpers.loadFixture(launchAndCompleteProject);

      expect(await ethers.provider.getBalance(await project.escrow.getAddress())).to.equal(0n);
      expect(await project.escrow.currentMilestoneIndex()).to.equal(2n);
    });
  });

  describe("refundFailedCrowdfund", function () {
    it("returns the deposit once the deadline passed without reaching the goal", async function () {
      const { escrow, alice } = await networkHelpers.loadFixture(launchProject);
      await sendEth(alice, await escrow.getAddress(), eth("1"));
      await time.increase(31 * DAY);

      const delta = await etherDelta(alice.address, () => escrow.connect(alice).refundFailedCrowdfund());

      expect(delta).to.equal(eth("1"));
      expect(await escrow.deposits(alice.address)).to.equal(0n);
    });

    it("reverts on a second refund", async function () {
      const { escrow, alice } = await networkHelpers.loadFixture(launchProject);
      await sendEth(alice, await escrow.getAddress(), eth("1"));
      await time.increase(31 * DAY);
      await escrow.connect(alice).refundFailedCrowdfund();

      await expect(escrow.connect(alice).refundFailedCrowdfund()).to.be.revertedWith(
        "No funds to refund",
      );
    });

    it("reverts before the deadline", async function () {
      const { escrow, alice } = await networkHelpers.loadFixture(launchProject);
      await sendEth(alice, await escrow.getAddress(), eth("1"));

      await expect(escrow.connect(alice).refundFailedCrowdfund()).to.be.revertedWith(
        "Deadline not reached yet",
      );
    });

    it("reverts when the goal was reached", async function () {
      const { escrow, alice } = await networkHelpers.loadFixture(launchAndFundProject);
      await time.increase(31 * DAY);

      await expect(escrow.connect(alice).refundFailedCrowdfund()).to.be.revertedWith(
        "Funding goal was reached",
      );
    });

    it("reverts once funding closed successfully", async function () {
      const { escrow, alice } = await networkHelpers.loadFixture(launchAndCloseProject);

      await expect(escrow.connect(alice).refundFailedCrowdfund()).to.be.revertedWith(
        "Funding already closed successfully",
      );
    });
  });

  describe("cancelProject", function () {
    it("lets the developer cancel and emits ProjectCancelled", async function () {
      const { escrow, developer } = await networkHelpers.loadFixture(launchAndCloseProject);

      await expect(escrow.connect(developer).cancelProject("pivot"))
        .to.emit(escrow, "ProjectCancelled")
        .withArgs("pivot");
      expect(await escrow.projectCancelled()).to.equal(true);
    });

    it("reverts for anyone but the developer or guardian", async function () {
      const { escrow, outsider, alice } = await networkHelpers.loadFixture(launchAndCloseProject);

      await expect(escrow.connect(outsider).cancelProject("x")).to.be.revertedWith(
        "Only developer or Guardian can cancel",
      );
      await expect(escrow.connect(alice).cancelProject("x")).to.be.revertedWith(
        "Only developer or Guardian can cancel",
      );
    });

    it("lets the guardian cancel and emits ProjectCancelled", async function () {
      const { escrow, treasury } = await networkHelpers.loadFixture(launchAndClaimProject);

      await expect(escrow.connect(treasury).cancelProject("developer stalled"))
        .to.emit(escrow, "ProjectCancelled")
        .withArgs("developer stalled");
      expect(await escrow.projectCancelled()).to.equal(true);
    });

    it("blocks voting, vote locks and execution after a guardian cancel", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      const { escrow, alice, bob, treasury } = project;
      await escrow.connect(alice).vote(true);
      await escrow.connect(bob).vote(true);
      expect(await escrow.isUserVoteLocked(alice.address)).to.equal(true);
      await escrow.connect(treasury).cancelProject("developer stalled");

      expect(await escrow.isUserVoteLocked(alice.address)).to.equal(false);
      await expect(escrow.connect(alice).vote(true)).to.be.revertedWith(
        "Project has been cancelled",
      );
      await expect(escrow.executeMilestone()).to.be.revertedWith("Project cancelled");
    });

    it("lets holders refund pro-rata after a guardian cancel without sweeping the ETH", async function () {
      const { escrow, token, treasury, alice } =
        await networkHelpers.loadFixture(launchAndClaimProject);
      await escrow.connect(treasury).cancelProject("developer stalled");
      await token.connect(alice).approve(await escrow.getAddress(), 320n * ONE_TOKEN);

      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(eth("9.5"));
      const delta = await etherDelta(alice.address, () => escrow.connect(alice).refundDeadProject());

      expect(delta).to.equal(eth("3.8"));
    });

    it("follows guardian rotation in the registry", async function () {
      const { escrow, registry, treasury, outsider } =
        await networkHelpers.loadFixture(launchAndClaimProject);
      await registry.connect(treasury).proposeGuardian(outsider.address);
      await registry.connect(outsider).acceptGuardian();

      await expect(escrow.connect(treasury).cancelProject("old")).to.be.revertedWith(
        "Only developer or Guardian can cancel",
      );
      await expect(escrow.connect(outsider).cancelProject("new")).to.emit(
        escrow,
        "ProjectCancelled",
      );
    });

    it("reverts when already cancelled", async function () {
      const { escrow, developer, treasury } =
        await networkHelpers.loadFixture(launchAndClaimProject);
      await escrow.connect(developer).cancelProject("stop");

      await expect(escrow.connect(treasury).cancelProject("again")).to.be.revertedWith(
        "Project already cancelled",
      );
    });

    it("reverts on a completed project", async function () {
      const { escrow, developer, treasury } =
        await networkHelpers.loadFixture(launchAndCompleteProject);

      await expect(escrow.connect(developer).cancelProject("x")).to.be.revertedWith(
        "Project is completed",
      );
      await expect(escrow.connect(treasury).cancelProject("x")).to.be.revertedWith(
        "Project is completed",
      );
    });

    it("reverts while funding is still active", async function () {
      const { escrow, developer } = await networkHelpers.loadFixture(launchAndFundProject);

      await expect(escrow.connect(developer).cancelProject("x")).to.be.revertedWith(
        "Funding still active",
      );
    });
  });

  describe("refundDeadProject", function () {
    it("pays holders their pro-rata share of the escrow after cancelProject", async function () {
      const { escrow, token, developer, alice } =
        await networkHelpers.loadFixture(launchAndClaimProject);
      await escrow.connect(developer).cancelProject("stop");
      await token.connect(alice).approve(await escrow.getAddress(), 320n * ONE_TOKEN);

      const delta = await etherDelta(alice.address, () => escrow.connect(alice).refundDeadProject());

      expect(delta).to.equal(eth("3.8"));
      expect(await token.balanceOf(alice.address)).to.equal(0n);
    });

    it("emits RefundClaimed", async function () {
      const { escrow, token, developer, bob } =
        await networkHelpers.loadFixture(launchAndClaimProject);
      await escrow.connect(developer).cancelProject("stop");
      await token.connect(bob).approve(await escrow.getAddress(), 240n * ONE_TOKEN);

      await expect(escrow.connect(bob).refundDeadProject())
        .to.emit(escrow, "RefundClaimed")
        .withArgs(bob.address, eth("2.85"));
    });

    it("keeps later refunds fair after an earlier holder refunded", async function () {
      const { escrow, token, developer, alice, bob } =
        await networkHelpers.loadFixture(launchAndClaimProject);
      await escrow.connect(developer).cancelProject("stop");
      await token.connect(alice).approve(await escrow.getAddress(), 320n * ONE_TOKEN);
      await token.connect(bob).approve(await escrow.getAddress(), 240n * ONE_TOKEN);
      await escrow.connect(alice).refundDeadProject();

      const delta = await etherDelta(bob.address, () => escrow.connect(bob).refundDeadProject());

      expect(delta).to.equal(eth("2.85"));
    });

    it("reverts on an uncancelled project however long it has been inactive", async function () {
      const { escrow, token, developer, alice } =
        await networkHelpers.loadFixture(launchAndClaimProject);
      await escrow.connect(developer).startMilestone(0);
      await token.connect(alice).approve(await escrow.getAddress(), 320n * ONE_TOKEN);
      await time.increase(400 * DAY);

      await expect(escrow.connect(alice).refundDeadProject()).to.be.revertedWith(
        "Project is not cancelled",
      );
    });

    it("reverts on a completed project", async function () {
      const { escrow, token, alice } = await networkHelpers.loadFixture(launchAndCompleteProject);
      await token.connect(alice).approve(await escrow.getAddress(), 320n * ONE_TOKEN);

      await expect(escrow.connect(alice).refundDeadProject()).to.be.revertedWith(
        "Project is completed",
      );
    });

    it("reverts while crowdfunding is still active", async function () {
      const { escrow, alice } = await networkHelpers.loadFixture(launchAndFundProject);

      await expect(escrow.connect(alice).refundDeadProject()).to.be.revertedWith(
        "Crowdfunding still active",
      );
    });

    it("reverts for the developer", async function () {
      const { escrow, developer } = await networkHelpers.loadFixture(launchAndClaimProject);
      await escrow.connect(developer).cancelProject("stop");

      await expect(escrow.connect(developer).refundDeadProject()).to.be.revertedWith(
        "Developer cannot claim refund",
      );
    });

    it("reverts for a holder whose tokens are staked", async function () {
      const { escrow, developer, alice } = await networkHelpers.loadFixture(
        launchAndStartMilestoneProject,
      );
      await escrow.connect(developer).cancelProject("stop");

      await expect(escrow.connect(alice).refundDeadProject()).to.be.revertedWith(
        "No tokens to refund. Unstake from distributor first.",
      );
    });
  });

  describe("developer transfer", function () {
    it("lets the developer propose a successor", async function () {
      const { escrow, developer, outsider } = await networkHelpers.loadFixture(launchProject);

      await expect(escrow.connect(developer).proposeNewDeveloper(outsider.address))
        .to.emit(escrow, "DeveloperTransferProposed")
        .withArgs(developer.address, outsider.address);
      expect(await escrow.pendingDeveloper()).to.equal(outsider.address);
    });

    it("lets the guardian propose a successor", async function () {
      const { escrow, treasury, outsider } = await networkHelpers.loadFixture(launchProject);
      await escrow.connect(treasury).proposeNewDeveloper(outsider.address);

      expect(await escrow.pendingDeveloper()).to.equal(outsider.address);
    });

    it("rejects proposals from other accounts", async function () {
      const { escrow, alice, outsider } = await networkHelpers.loadFixture(launchProject);

      await expect(
        escrow.connect(alice).proposeNewDeveloper(outsider.address),
      ).to.be.revertedWith("Only active dev or Guardian can propose");
    });

    it("rejects the zero address", async function () {
      const { escrow, developer } = await networkHelpers.loadFixture(launchProject);

      await expect(
        escrow.connect(developer).proposeNewDeveloper(ethers.ZeroAddress),
      ).to.be.revertedWith("Cannot transfer to zero address");
    });

    it("hands over the role when the pending developer accepts", async function () {
      const { escrow, developer, outsider } = await networkHelpers.loadFixture(launchProject);
      await escrow.connect(developer).proposeNewDeveloper(outsider.address);

      await expect(escrow.connect(outsider).acceptDeveloperRole())
        .to.emit(escrow, "DeveloperTransferAccepted")
        .withArgs(developer.address, outsider.address);
      expect(await escrow.developer()).to.equal(outsider.address);
      expect(await escrow.pendingDeveloper()).to.equal(ethers.ZeroAddress);
    });

    it("rejects acceptance by anyone but the pending developer", async function () {
      const { escrow, developer, alice, outsider } =
        await networkHelpers.loadFixture(launchProject);
      await escrow.connect(developer).proposeNewDeveloper(outsider.address);

      await expect(escrow.connect(alice).acceptDeveloperRole()).to.be.revertedWith(
        "Only pending developer can accept",
      );
    });
  });

  describe("emergencyShutdown", function () {
    it("reverts for anyone but the guardian", async function () {
      const { escrow, developer } = await networkHelpers.loadFixture(launchAndClaimProject);

      await expect(escrow.connect(developer).emergencyShutdown()).to.be.revertedWith(
        "Only Guardian can trigger emergency shutdown",
      );
    });

    it("cancels the project and emits the swept ETH and burned tokens", async function () {
      const { escrow, treasury } = await networkHelpers.loadFixture(launchAndClaimProject);

      await expect(escrow.connect(treasury).emergencyShutdown())
        .to.emit(escrow, "EmergencyShutdownTriggered")
        .withArgs(eth("9.5"), DEVELOPER_SUPPLY);
      expect(await escrow.projectCancelled()).to.equal(true);
    });

    it("sweeps all escrow ETH to the treasury", async function () {
      const { escrow, treasury } = await networkHelpers.loadFixture(launchAndClaimProject);

      const delta = await etherDelta(treasury.address, () =>
        escrow.connect(treasury).emergencyShutdown(),
      );

      expect(delta).to.equal(eth("9.5"));
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(0n);
    });

    it("invalidates the token and burns the unvested developer tokens", async function () {
      const { escrow, token, treasury, alice, bob } =
        await networkHelpers.loadFixture(launchAndClaimProject);
      await escrow.connect(treasury).emergencyShutdown();

      expect(await token.isInvalidated()).to.equal(true);
      expect(await token.balanceOf(await escrow.getAddress())).to.equal(0n);
      expect(await token.totalSupply()).to.equal(800n * ONE_TOKEN);
      await expect(token.connect(alice).transfer(bob.address, 1n)).to.be.revertedWith(
        "Token is dead (Emergency Shutdown)",
      );
    });

    it("lets the guardian shut down a completed project", async function () {
      const { escrow, token, treasury } = await networkHelpers.loadFixture(launchAndCompleteProject);

      await expect(escrow.connect(treasury).emergencyShutdown())
        .to.emit(escrow, "EmergencyShutdownTriggered")
        .withArgs(0n, 0n);
      expect(await escrow.projectCancelled()).to.equal(true);
      expect(await token.isInvalidated()).to.equal(true);
    });

    it("reverts on a cancelled project while refunds are still open", async function () {
      const { escrow, developer, treasury } =
        await networkHelpers.loadFixture(launchAndClaimProject);
      await escrow.connect(developer).cancelProject("stop");

      await expect(escrow.connect(treasury).emergencyShutdown()).to.be.revertedWith(
        "Refunds still open",
      );
    });
  });
});
