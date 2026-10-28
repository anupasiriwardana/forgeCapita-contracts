import { expect } from "chai";
import { ONE_TOKEN, ethers, launchAndClaimProject, launchAndStartMilestoneProject, networkHelpers } from "./helpers/protocol.js";
import {
  CLAIM,
  STAKE,
  VOTE,
  type Project,
  claimStakeAndStart,
  enableRelayer,
  eth,
  futureDeadline,
  launchClosedWithMilestones,
  setCap,
  signPermit,
  signVote,
} from "./helpers/extra.js";

const { time } = networkHelpers;

async function closedWithRelayer(): Promise<Project> {
  const project = await launchClosedWithMilestones([40n, 60n]);
  await enableRelayer(project);
  return project;
}

/** Gap-filling tests for CON-03.1, written after auditing SignedActions.ts, Permit.ts and GasLedger.ts. */
describe("Signed actions: coverage additions", function () {
  describe("voteBySig deadline and replay boundaries", function () {
    it("accepts a signature in the very second of its deadline and rejects one second later", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      const { escrow, alice, bob, outsider } = project;
      const deadline = await futureDeadline(600n);
      const aliceSig = await signVote(project, alice, true, deadline, 0n);
      const bobSig = await signVote(project, bob, true, deadline, 0n);

      await time.setNextBlockTimestamp(deadline);
      await escrow.connect(outsider).voteBySig(alice.address, true, deadline, aliceSig);
      expect(await escrow.hasVoted(0n, alice.address)).to.equal(true);

      await time.setNextBlockTimestamp(deadline + 1n);
      await expect(
        escrow.connect(outsider).voteBySig(bob.address, true, deadline, bobSig),
      ).to.be.revertedWith("Vote signature expired");
      expect(await escrow.hasVoted(0n, bob.address)).to.equal(false);
    });

    it("cannot replay a milestone-0 signature on milestone 1, but a fresh one works", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      const { escrow, alice, outsider, developer } = project;
      const deadline = await futureDeadline(30n * 24n * 3600n);
      const oldSig = await signVote(project, alice, true, deadline, 0n);
      await escrow.connect(outsider).voteBySig(alice.address, true, deadline, oldSig);
      await escrow.connect(project.bob).vote(true);
      await escrow.executeMilestone();
      await escrow.connect(developer).startMilestone(1);

      await expect(
        escrow.connect(outsider).voteBySig(alice.address, true, deadline, oldSig),
      ).to.be.revertedWith("Invalid vote signature");
      expect(await escrow.hasVoted(1n, alice.address)).to.equal(false);

      const freshSig = await signVote(project, alice, true, deadline, 1n);
      await escrow.connect(outsider).voteBySig(alice.address, true, deadline, freshSig);
      expect(await escrow.hasVoted(1n, alice.address)).to.equal(true);
    });

    it("rejects empty, truncated and garbage signatures", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      const { escrow, alice, outsider } = project;
      const deadline = await futureDeadline();
      const valid = await signVote(project, alice, true, deadline, 0n);

      for (const bad of ["0x", valid.slice(0, valid.length - 2), "0x" + "11".repeat(65)]) {
        await expect(
          escrow.connect(outsider).voteBySig(alice.address, true, deadline, bad),
        ).to.be.revertedWith("Invalid vote signature");
      }
      expect(await escrow.hasVoted(0n, alice.address)).to.equal(false);
    });

    it("rejects a signature for a zero-address voter", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      const { escrow, alice, outsider } = project;
      const deadline = await futureDeadline();
      const sig = await signVote(project, alice, true, deadline, 0n);

      await expect(
        escrow.connect(outsider).voteBySig(ethers.ZeroAddress, true, deadline, sig),
      ).to.be.revertedWith("Invalid vote signature");
    });
  });

  describe("allow-listed relayer rules for signed votes", function () {
    async function stakedWithRelayer(): Promise<Project> {
      const project = await closedWithRelayer();
      await claimStakeAndStart(project);
      return project;
    }

    it("records the cost only for an allow-listed relayer, not for any other submitter", async function () {
      const project = await networkHelpers.loadFixture(stakedWithRelayer);
      const { escrow, alice, bob, carol, outsider } = project;
      await setCap(project, eth("0.1"));
      const deadline = await futureDeadline();

      await expect(
        escrow
          .connect(carol)
          .voteBySig(bob.address, true, deadline, await signVote(project, bob, true, deadline, 0n)),
      ).to.not.emit(escrow, "SponsoredGas");
      expect(await escrow.gasSpent()).to.equal(0n);

      await expect(
        escrow
          .connect(outsider)
          .voteBySig(alice.address, true, deadline, await signVote(project, alice, true, deadline, 0n)),
      )
        .to.emit(escrow, "SponsoredGas")
        .withArgs(outsider.address, alice.address, VOTE, eth("0.1"), eth("0.1"));
    });

    it("stops recording once the relayer is removed and resumes when it is re-added", async function () {
      const project = await networkHelpers.loadFixture(stakedWithRelayer);
      const { escrow, registry, treasury, alice, bob, outsider } = project;
      await setCap(project, eth("0.1"));
      const deadline = await futureDeadline();
      await registry.connect(treasury).setRelayer(outsider.address, false);

      await escrow
        .connect(outsider)
        .voteBySig(alice.address, true, deadline, await signVote(project, alice, true, deadline, 0n));
      expect(await escrow.gasSpent()).to.equal(0n);

      await registry.connect(treasury).setRelayer(outsider.address, true);
      await escrow
        .connect(outsider)
        .voteBySig(bob.address, true, deadline, await signVote(project, bob, true, deadline, 0n));
      expect(await escrow.gasSpent()).to.equal(eth("0.1"));
    });

    it("reverts the whole signed vote when the relayer would exceed the ceiling, and a user can still submit it", async function () {
      const project = await networkHelpers.loadFixture(closedWithRelayer);
      const { escrow, alice, bob, outsider } = project;
      await setCap(project, eth("0.9625"));
      await escrow.connect(outsider).claimTokensFor(alice.address);
      await escrow.connect(outsider).claimTokensFor(bob.address);
      expect(await escrow.gasSpent()).to.equal(eth("1.925"));
      await claimStakeAndStart(project);
      const deadline = await futureDeadline();
      const sig = await signVote(project, alice, true, deadline, 0n);

      await expect(
        escrow.connect(outsider).voteBySig(alice.address, true, deadline, sig),
      ).to.be.revertedWith("Gas ceiling exceeded");
      expect(await escrow.hasVoted(0n, alice.address)).to.equal(false);
      expect((await escrow.milestones(0n)).yesVotes).to.equal(0n);
      expect(await escrow.gasSpent()).to.equal(eth("1.925"));

      await escrow.connect(project.carol).voteBySig(alice.address, true, deadline, sig);
      expect((await escrow.milestones(0n)).yesVotes).to.equal(320n * ONE_TOKEN);
    });
  });

  describe("claimTokensFor by a relayer", function () {
    it("delivers tokens to the depositor and never to the relayer", async function () {
      const project = await networkHelpers.loadFixture(closedWithRelayer);
      const { escrow, token, alice, outsider } = project;
      await setCap(project, eth("0.1"));

      await expect(escrow.connect(outsider).claimTokensFor(alice.address))
        .to.emit(escrow, "SponsoredGas")
        .withArgs(outsider.address, alice.address, CLAIM, eth("0.1"), eth("0.1"));

      expect(await token.balanceOf(alice.address)).to.equal(320n * ONE_TOKEN);
      expect(await token.balanceOf(outsider.address)).to.equal(0n);
    });

    it("reverts the claim, leaving it open for a self-claim, when the ceiling would be exceeded", async function () {
      const project = await networkHelpers.loadFixture(closedWithRelayer);
      const { escrow, alice, bob, carol, outsider } = project;
      await setCap(project, eth("0.9625"));
      await escrow.connect(outsider).claimTokensFor(alice.address);
      await escrow.connect(outsider).claimTokensFor(bob.address);

      await expect(escrow.connect(outsider).claimTokensFor(carol.address)).to.be.revertedWith(
        "Gas ceiling exceeded",
      );
      expect(await escrow.hasClaimedTokens(carol.address)).to.equal(false);
      await escrow.connect(carol).claimTokens();
    });
  });

  describe("stakeWithPermit: signature binding", function () {
    const amount = 100n * ONE_TOKEN;

    it("cannot replay a permit that was already used", async function () {
      const project = await networkHelpers.loadFixture(launchAndClaimProject);
      const { token, distributor, alice, outsider } = project;
      const spender = await distributor.getAddress();
      const deadline = await futureDeadline();
      const sig = await signPermit(project, alice, spender, amount, deadline);
      await distributor
        .connect(outsider)
        .stakeWithPermit(alice.address, amount, deadline, sig.v, sig.r, sig.s);

      await expect(
        distributor
          .connect(outsider)
          .stakeWithPermit(alice.address, amount, deadline, sig.v, sig.r, sig.s),
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
      expect(await distributor.stakedBalance(alice.address)).to.equal(amount);
      expect(await token.nonces(alice.address)).to.equal(1n);
    });

    it("fails for an expired permit without allowance, but tolerates it when the allowance already suffices", async function () {
      const project = await networkHelpers.loadFixture(launchAndClaimProject);
      const { token, distributor, alice, outsider } = project;
      const spender = await distributor.getAddress();
      const deadline = await futureDeadline(100n);
      const sig = await signPermit(project, alice, spender, amount, deadline);
      await time.increase(200);

      await expect(
        distributor
          .connect(outsider)
          .stakeWithPermit(alice.address, amount, deadline, sig.v, sig.r, sig.s),
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");

      await token.connect(alice).approve(spender, amount);
      await distributor
        .connect(outsider)
        .stakeWithPermit(alice.address, amount, deadline, sig.v, sig.r, sig.s);
      expect(await distributor.stakedBalance(alice.address)).to.equal(amount);
      expect(await token.nonces(alice.address)).to.equal(0n);
    });

    it("fails for a permit signed for another chain, another verifying contract or another spender", async function () {
      const project = await networkHelpers.loadFixture(launchAndClaimProject);
      const { token, distributor, alice, outsider } = project;
      const spender = await distributor.getAddress();
      const deadline = await futureDeadline();
      const attempts = [
        await signPermit(project, alice, spender, amount, deadline, { chainId: 1n }),
        await signPermit(project, alice, spender, amount, deadline, { verifyingContract: spender }),
        await signPermit(project, alice, outsider.address, amount, deadline),
      ];

      for (const sig of attempts) {
        await expect(
          distributor
            .connect(outsider)
            .stakeWithPermit(alice.address, amount, deadline, sig.v, sig.r, sig.s),
        ).to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
      }
      expect(await distributor.totalStaked()).to.equal(0n);
      expect(await token.nonces(alice.address)).to.equal(0n);
    });

    it("fails when the staked amount differs from the permitted amount", async function () {
      const project = await networkHelpers.loadFixture(launchAndClaimProject);
      const { token, distributor, alice, outsider } = project;
      const spender = await distributor.getAddress();
      const deadline = await futureDeadline();
      const sig = await signPermit(project, alice, spender, amount, deadline);

      await expect(
        distributor
          .connect(outsider)
          .stakeWithPermit(alice.address, amount * 2n, deadline, sig.v, sig.r, sig.s),
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
    });

    it("credits the stake to the owner, never to the submitter, including for a relayer", async function () {
      const project = await networkHelpers.loadFixture(closedWithRelayer);
      const { distributor, token, escrow, alice, outsider } = project;
      await escrow.connect(alice).claimTokens();
      await setCap(project, eth("0.1"));
      const spender = await distributor.getAddress();
      const deadline = await futureDeadline();
      const sig = await signPermit(project, alice, spender, amount, deadline);

      await expect(
        distributor
          .connect(outsider)
          .stakeWithPermit(alice.address, amount, deadline, sig.v, sig.r, sig.s),
      )
        .to.emit(escrow, "SponsoredGas")
        .withArgs(outsider.address, alice.address, STAKE, eth("0.1"), eth("0.1"));

      expect(await distributor.stakedBalance(alice.address)).to.equal(amount);
      expect(await distributor.stakedBalance(outsider.address)).to.equal(0n);
      expect(await token.balanceOf(outsider.address)).to.equal(0n);
    });

    it("stops recording once the relayer is removed", async function () {
      const project = await networkHelpers.loadFixture(closedWithRelayer);
      const { distributor, escrow, registry, treasury, alice, outsider } = project;
      await escrow.connect(alice).claimTokens();
      await setCap(project, eth("0.1"));
      await registry.connect(treasury).setRelayer(outsider.address, false);
      const deadline = await futureDeadline();
      const sig = await signPermit(project, alice, await distributor.getAddress(), amount, deadline);

      await distributor
        .connect(outsider)
        .stakeWithPermit(alice.address, amount, deadline, sig.v, sig.r, sig.s);

      expect(await escrow.gasSpent()).to.equal(0n);
    });

    it("reverts the whole stake, including the permit, when the relayer would exceed the ceiling", async function () {
      const project = await networkHelpers.loadFixture(closedWithRelayer);
      const { distributor, token, escrow, alice, bob, carol, outsider } = project;
      await setCap(project, eth("0.9625"));
      await escrow.connect(outsider).claimTokensFor(bob.address);
      await escrow.connect(outsider).claimTokensFor(carol.address);
      await escrow.connect(alice).claimTokens();
      const spender = await distributor.getAddress();
      const deadline = await futureDeadline();
      const sig = await signPermit(project, alice, spender, amount, deadline);

      await expect(
        distributor
          .connect(outsider)
          .stakeWithPermit(alice.address, amount, deadline, sig.v, sig.r, sig.s),
      ).to.be.revertedWith("Gas ceiling exceeded");
      expect(await distributor.stakedBalance(alice.address)).to.equal(0n);
      expect(await token.nonces(alice.address)).to.equal(0n);
      expect(await token.allowance(alice.address, spender)).to.equal(0n);

      await distributor
        .connect(bob)
        .stakeWithPermit(alice.address, amount, deadline, sig.v, sig.r, sig.s);
      expect(await distributor.stakedBalance(alice.address)).to.equal(amount);
    });
  });
});
