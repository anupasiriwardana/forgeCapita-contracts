import { expect } from "chai";
import { DEVELOPER_SUPPLY, ethers, etherDelta, networkHelpers } from "./helpers/protocol.js";
import {
  CLAIM,
  EXECUTE,
  STAKE,
  VOTE,
  type Project,
  approveAndExecute,
  claimStakeAndStart,
  enableRelayer,
  eth,
  futureDeadline,
  launchClosedWithMilestones,
  setCap,
  signPermit,
  signVote,
} from "./helpers/extra.js";

async function relayedProject(percentages: bigint[]): Promise<Project> {
  const project = await launchClosedWithMilestones(percentages);
  await enableRelayer(project);
  return project;
}

/** Spends exactly `total` on the ledger with two relayer claims (alice and bob). */
async function spendWithTwoClaims(project: Project, total: bigint): Promise<void> {
  await setCap(project, total / 2n);
  await project.escrow.connect(project.outsider).claimTokensFor(project.alice.address);
  await project.escrow.connect(project.outsider).claimTokensFor(project.bob.address);
  expect(await project.escrow.gasSpent()).to.equal(total);
}

/** Gap-filling tests for CON-03.2, written after auditing GasLedger.ts. */
describe("Gas ledger: coverage additions", function () {
  describe("budget boundary", function () {
    it("deducts exactly one wei when spending is one wei over the budget", async function () {
      const project = await relayedProject([40n, 60n]);
      const { escrow, alice, bob, carol, outsider } = project;
      await setCap(project, eth("0.25"));
      await escrow.connect(outsider).claimTokensFor(alice.address);
      await escrow.connect(outsider).claimTokensFor(bob.address);
      await setCap(project, 1n);
      await escrow.connect(outsider).claimTokensFor(carol.address);
      expect(await escrow.gasSpent()).to.equal((await escrow.gasBudget()) + 1n);
      await claimStakeAndStart(project);

      const tx = approveAndExecute(project);
      await expect(tx).to.emit(escrow, "GasDebtRecovered").withArgs(0n, 1n, 0n);
      await expect(tx).to.emit(escrow, "MilestoneExecuted").withArgs(0n, eth("3.8") - 1n, 0n, 1n);
    });

    it("rejects a sponsored action that is one wei above the ceiling", async function () {
      const project = await relayedProject([40n, 60n]);
      const { escrow, alice, bob, carol, outsider } = project;
      await spendWithTwoClaims(project, eth("1.925"));
      await setCap(project, 1n);

      await expect(escrow.connect(outsider).claimTokensFor(carol.address)).to.be.revertedWith(
        "Gas ceiling exceeded",
      );
      expect(await escrow.gasSpent()).to.equal(eth("1.925"));
      expect(await escrow.hasClaimedTokens(alice.address)).to.equal(true);
      expect(await escrow.hasClaimedTokens(bob.address)).to.equal(true);
    });
  });

  describe("per-action cap and surcharge", function () {
    it("applies each action's own surcharge for stake, vote and execute", async function () {
      const project = await relayedProject([40n, 60n]);
      const { escrow, distributor, token, registry, treasury, alice, bob, outsider } = project;
      const guardian = registry.connect(treasury);
      await setCap(project, eth("1"));
      await guardian.setL1Surcharge(STAKE, eth("0.01"));
      await guardian.setL1Surcharge(VOTE, eth("0.02"));
      await guardian.setL1Surcharge(EXECUTE, eth("0.03"));
      await escrow.connect(alice).claimTokens();
      await escrow.connect(bob).claimTokens();
      const spender = await distributor.getAddress();
      const deadline = await futureDeadline();
      const amount = 100n * 10n ** 18n;
      const permit = await signPermit(project, alice, spender, amount, deadline);
      await distributor
        .connect(outsider)
        .stakeWithPermit(alice.address, amount, deadline, permit.v, permit.r, permit.s);
      const stakeCost = await escrow.gasSpent();
      expect(stakeCost >= eth("0.01") && stakeCost < eth("0.02")).to.equal(true);

      await token.connect(bob).approve(spender, 240n * 10n ** 18n);
      await distributor.connect(bob).stake(240n * 10n ** 18n);
      await token.connect(alice).approve(spender, 220n * 10n ** 18n);
      await distributor.connect(alice).stake(220n * 10n ** 18n);
      await escrow.connect(project.developer).startMilestone(0);
      const before = await escrow.gasSpent();
      await escrow
        .connect(outsider)
        .voteBySig(alice.address, true, deadline, await signVote(project, alice, true, deadline, 0n));
      const voteCost = (await escrow.gasSpent()) - before;
      expect(voteCost >= eth("0.02") && voteCost < eth("0.03")).to.equal(true);

      await escrow.connect(bob).vote(true);
      const beforeExecute = await escrow.gasSpent();
      await escrow.connect(outsider).executeMilestone();
      const executeCost = (await escrow.gasSpent()) - beforeExecute;
      expect(executeCost >= eth("0.03") && executeCost < eth("0.04")).to.equal(true);
    });

    it("records a zero cost when the cap is zero", async function () {
      const project = await relayedProject([40n, 60n]);
      const { escrow, alice, outsider } = project;
      await setCap(project, 0n);

      await expect(escrow.connect(outsider).claimTokensFor(alice.address))
        .to.emit(escrow, "SponsoredGas")
        .withArgs(outsider.address, alice.address, CLAIM, 0n, 0n);
      expect(await escrow.gasSpent()).to.equal(0n);
    });

    it("applies a cap lowered mid-project to later actions only", async function () {
      const project = await relayedProject([40n, 60n]);
      const { escrow, alice, bob, outsider } = project;
      await setCap(project, eth("0.4"));
      await escrow.connect(outsider).claimTokensFor(alice.address);
      await setCap(project, eth("0.1"));
      await escrow.connect(outsider).claimTokensFor(bob.address);

      expect(await escrow.gasSpent()).to.equal(eth("0.5"));
    });
  });

  describe("relayer removed mid-project", function () {
    it("makes a former relayer's executeMilestone free of cost and leaves the debt untouched", async function () {
      const project = await relayedProject([40n, 60n]);
      const { escrow, registry, treasury, outsider } = project;
      await spendWithTwoClaims(project, eth("0.75"));
      await claimStakeAndStart(project);
      await registry.connect(treasury).setRelayer(outsider.address, false);
      await setCap(project, eth("1"));

      const tx = approveAndExecute(project, outsider);

      await expect(tx).to.not.emit(escrow, "SponsoredGas");
      await expect(tx).to.emit(escrow, "MilestoneExecuted").withArgs(0n, eth("3.8") - eth("0.25"), 0n, eth("0.25"));
      expect(await escrow.gasSpent()).to.equal(eth("0.75"));
    });

    it("keeps debt booked before the removal recoverable from payouts", async function () {
      const project = await relayedProject([40n, 60n]);
      const { escrow, registry, treasury, outsider } = project;
      await spendWithTwoClaims(project, eth("0.75"));
      await registry.connect(treasury).setRelayer(outsider.address, false);
      await claimStakeAndStart(project);

      await approveAndExecute(project);

      expect(await escrow.gasRecovered()).to.equal(eth("0.25"));
    });
  });

  describe("15% cap with carry-over across five milestones", function () {
    it("recovers the overflow in capped steps and stops when it is repaid", async function () {
      const project = await relayedProject([10n, 10n, 20n, 25n, 35n]);
      const { escrow, treasury, developer } = project;
      // budget 0.5, overflow 0.8; caps are 15% of the releases 0.95, 0.95, 1.9, 2.375, 3.325
      await spendWithTwoClaims(project, eth("1.3"));
      await claimStakeAndStart(project);
      const releases = [eth("0.95"), eth("0.95"), eth("1.9"), eth("2.375"), eth("3.325")];
      const deductions = [eth("0.1425"), eth("0.1425"), eth("0.285"), eth("0.23"), 0n];
      const outstanding = [eth("0.6575"), eth("0.515"), eth("0.23"), 0n, 0n];

      for (let index = 0; index < 5; index++) {
        if (index > 0) await escrow.connect(developer).startMilestone(index);
        const treasuryBefore = await ethers.provider.getBalance(treasury.address);
        const tx = approveAndExecute(project);
        const tokens = index === 4 ? DEVELOPER_SUPPLY : 0n;
        await expect(tx)
          .to.emit(escrow, "MilestoneExecuted")
          .withArgs(BigInt(index), releases[index] - deductions[index], tokens, deductions[index]);
        if (deductions[index] > 0n) {
          await expect(tx)
            .to.emit(escrow, "GasDebtRecovered")
            .withArgs(BigInt(index), deductions[index], outstanding[index]);
        } else {
          await expect(tx).to.not.emit(escrow, "GasDebtRecovered");
        }
        await expect(tx).to.not.emit(escrow, "GasDebtWrittenOff");
        expect(await ethers.provider.getBalance(treasury.address)).to.equal(
          treasuryBefore + deductions[index],
        );
      }

      expect(await escrow.gasRecovered()).to.equal(eth("0.8"));
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(0n);
    });

    it("never deducts more than 15% of any release even with the debt at the ceiling", async function () {
      const project = await relayedProject([10n, 10n, 20n, 25n, 35n]);
      const { escrow, developer } = project;
      await spendWithTwoClaims(project, eth("1.925"));
      await claimStakeAndStart(project);
      const releases = [eth("0.95"), eth("0.95"), eth("1.9"), eth("2.375"), eth("3.325")];

      let recovered = 0n;
      for (let index = 0; index < 5; index++) {
        if (index > 0) await escrow.connect(developer).startMilestone(index);
        await approveAndExecute(project);
        const delta = (await escrow.gasRecovered()) - recovered;
        recovered += delta;
        expect(delta).to.equal((releases[index] * 1500n) / 10_000n);
      }
      expect(recovered).to.equal(eth("1.425"));
    });
  });

  describe("final-milestone write-off of a large balance", function () {
    it("repays what the last payout allows, writes off the rest and keeps the vesting", async function () {
      const project = await relayedProject([90n, 10n]);
      const { escrow, token, treasury, developer, alice, bob, outsider } = project;
      await claimStakeAndStart(project);
      await approveAndExecute(project);
      await escrow.connect(developer).startMilestone(1);
      await setCap(project, eth("0.9625"));
      const deadline = await futureDeadline();
      for (const voter of [alice, bob]) {
        await escrow
          .connect(outsider)
          .voteBySig(voter.address, true, deadline, await signVote(project, voter, true, deadline, 1n));
      }
      expect(await escrow.gasSpent()).to.equal(eth("1.925"));

      const treasuryDelta = await etherDelta(treasury.address, async () => {
        const tx = escrow.connect(project.deployer).executeMilestone();
        await expect(tx).to.emit(escrow, "GasDebtWrittenOff").withArgs(eth("1.2825"));
        await expect(tx).to.emit(escrow, "GasDebtRecovered").withArgs(1n, eth("0.1425"), eth("1.2825"));
        await expect(tx)
          .to.emit(escrow, "MilestoneExecuted")
          .withArgs(1n, eth("0.95") - eth("0.1425"), DEVELOPER_SUPPLY, eth("0.1425"));
        return tx;
      });

      expect(treasuryDelta).to.equal(eth("0.1425"));
      expect(await token.balanceOf(developer.address)).to.equal(DEVELOPER_SUPPLY);
      expect(await escrow.completed()).to.equal(true);
      expect(await escrow.gasRecovered()).to.equal(eth("0.1425"));
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(0n);
    });

    it("counts a relayer-submitted final execute in the debt before the write-off", async function () {
      const project = await relayedProject([90n, 10n]);
      const { escrow, developer, outsider } = project;
      await claimStakeAndStart(project);
      await approveAndExecute(project);
      await escrow.connect(developer).startMilestone(1);
      await setCap(project, eth("0.9625"));
      const deadline = await futureDeadline();
      await escrow
        .connect(outsider)
        .voteBySig(
          project.alice.address,
          true,
          deadline,
          await signVote(project, project.alice, true, deadline, 1n),
        );
      await escrow.connect(project.bob).vote(true);

      const tx = escrow.connect(outsider).executeMilestone();

      await expect(tx)
        .to.emit(escrow, "SponsoredGas")
        .withArgs(outsider.address, ethers.ZeroAddress, EXECUTE, eth("0.9625"), eth("1.925"));
      await expect(tx).to.emit(escrow, "GasDebtWrittenOff").withArgs(eth("1.2825"));
      await expect(tx)
        .to.emit(escrow, "MilestoneExecuted")
        .withArgs(1n, eth("0.95") - eth("0.1425"), DEVELOPER_SUPPLY, eth("0.1425"));
      expect(await escrow.completed()).to.equal(true);
    });
  });
});
