import { expect } from "chai";
import {
  DAY,
  ONE_TOKEN,
  approveCurrentMilestone,
  ethers,
  launchAndClaimProject,
  launchAndCloseProject,
  launchAndCompleteProject,
  launchAndStartMilestoneProject,
  launchProject,
  networkHelpers,
} from "./helpers/protocol.js";
import { cancelAndWaitRefundWindow } from "./helpers/extra.js";

const FREEZE = 45n * BigInt(DAY);
const MAX_TOTAL = 90n * BigInt(DAY);

const VOTE_TYPES = {
  Vote: [
    { name: "voter", type: "address" },
    { name: "milestoneIndex", type: "uint256" },
    { name: "support", type: "bool" },
    { name: "deadline", type: "uint256" },
  ],
};

const PERMIT_TYPES = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

type Project = Awaited<ReturnType<typeof launchAndStartMilestoneProject>>;
type Tx = { wait(): Promise<{ blockNumber: number } | null> };

async function blockTime(tx: Tx): Promise<bigint> {
  const receipt = await tx.wait();
  if (receipt === null) throw new Error("receipt missing");
  const block = await ethers.provider.getBlock(receipt.blockNumber);
  if (block === null) throw new Error("block missing");
  return BigInt(block.timestamp);
}

async function passFreeze(): Promise<void> {
  await networkHelpers.time.increase(FREEZE + 10n);
}

async function freezeNow(project: Project): Promise<bigint> {
  return blockTime(await project.escrow.connect(project.treasury).freezeMilestones());
}

describe("Freeze", function () {
  describe("access control", function () {
    it("lets only the guardian freeze", async function () {
      const { escrow, developer, alice, outsider } =
        await networkHelpers.loadFixture(launchAndStartMilestoneProject);

      for (const caller of [developer, alice, outsider]) {
        await expect(escrow.connect(caller).freezeMilestones()).to.be.revertedWith(
          "Only Guardian can freeze",
        );
      }
    });

    it("lets only the guardian unfreeze", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      const { escrow, developer, alice, outsider } = project;
      await freezeNow(project);

      for (const caller of [developer, alice, outsider]) {
        await expect(escrow.connect(caller).unfreezeMilestones()).to.be.revertedWith(
          "Only Guardian can unfreeze",
        );
      }
    });

    it("rejects a registered relayer", async function () {
      const { escrow, registry, treasury, outsider } =
        await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      await registry.connect(treasury).setRelayer(outsider.address, true);

      await expect(escrow.connect(outsider).freezeMilestones()).to.be.revertedWith(
        "Only Guardian can freeze",
      );
    });

    it("follows guardian rotation: the old guardian loses the right, the new one gains it", async function () {
      const { escrow, registry, treasury, outsider } =
        await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      await registry.connect(treasury).proposeGuardian(outsider.address);
      await registry.connect(outsider).acceptGuardian();

      await expect(escrow.connect(treasury).freezeMilestones()).to.be.revertedWith(
        "Only Guardian can freeze",
      );
      await escrow.connect(outsider).freezeMilestones();
      expect(await escrow.isFrozen()).to.equal(true);
      await expect(escrow.connect(treasury).unfreezeMilestones()).to.be.revertedWith(
        "Only Guardian can unfreeze",
      );
      await escrow.connect(outsider).unfreezeMilestones();
      expect(await escrow.isFrozen()).to.equal(false);
    });
  });

  describe("executeMilestone", function () {
    it("reverts while frozen and works after unfreeze", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      const { escrow, treasury, outsider } = project;
      await approveCurrentMilestone(project);
      await freezeNow(project);

      await expect(escrow.connect(outsider).executeMilestone()).to.be.revertedWith(
        "Milestones frozen",
      );

      await escrow.connect(treasury).unfreezeMilestones();
      await expect(escrow.connect(outsider).executeMilestone()).to.emit(
        escrow,
        "MilestoneExecuted",
      );
    });

    it("works after the freeze lapses with no transaction", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      const { escrow, outsider } = project;
      await approveCurrentMilestone(project);
      await freezeNow(project);
      expect(await escrow.isFrozen()).to.equal(true);

      await passFreeze();

      expect(await escrow.isFrozen()).to.equal(false);
      await escrow.connect(outsider).executeMilestone();
      expect(await escrow.currentMilestoneIndex()).to.equal(1n);
    });

    it("stays frozen just before the 45 days end", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      const { escrow } = project;
      await approveCurrentMilestone(project);
      await freezeNow(project);

      await networkHelpers.time.increase(FREEZE - 100n);

      expect(await escrow.isFrozen()).to.equal(true);
    });
  });

  describe("freezeMilestones", function () {
    it("emits MilestonesFrozen and records the state", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      const { escrow, treasury } = project;

      const tx = await escrow.connect(treasury).freezeMilestones();
      const at = await blockTime(tx);

      await expect(tx).to.emit(escrow, "MilestonesFrozen").withArgs(at + FREEZE, FREEZE);
      expect(await escrow.freezeStart()).to.equal(at);
      expect(await escrow.frozenUntil()).to.equal(at + FREEZE);
      expect(await escrow.isFrozen()).to.equal(true);
      expect(await escrow.MAX_FREEZE_DURATION()).to.equal(FREEZE);
      expect(await escrow.MAX_TOTAL_FREEZE()).to.equal(MAX_TOTAL);
    });

    it("reverts when already frozen (no extension)", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      await freezeNow(project);

      await expect(project.escrow.connect(project.treasury).freezeMilestones()).to.be.revertedWith(
        "Already frozen",
      );
    });

    it("reverts before funding closed", async function () {
      const { escrow, treasury } = await networkHelpers.loadFixture(launchProject);

      await expect(escrow.connect(treasury).freezeMilestones()).to.be.revertedWith(
        "Funding still active",
      );
    });

    it("reverts on a cancelled project", async function () {
      const { escrow, treasury, developer } =
        await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      await escrow.connect(developer).cancelProject("stop");

      await expect(escrow.connect(treasury).freezeMilestones()).to.be.revertedWith(
        "Project cancelled",
      );
    });

    it("reverts on a completed project", async function () {
      const { escrow, treasury } = await networkHelpers.loadFixture(launchAndCompleteProject);

      await expect(escrow.connect(treasury).freezeMilestones()).to.be.revertedWith(
        "Project is completed",
      );
    });
  });

  describe("unfreezeMilestones", function () {
    it("reverts when not frozen", async function () {
      const { escrow, treasury } = await networkHelpers.loadFixture(launchAndStartMilestoneProject);

      await expect(escrow.connect(treasury).unfreezeMilestones()).to.be.revertedWith("Not frozen");
    });

    it("reverts after the freeze lapsed", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      await freezeNow(project);
      await passFreeze();

      await expect(
        project.escrow.connect(project.treasury).unfreezeMilestones(),
      ).to.be.revertedWith("Not frozen");
    });

    it("counts only the time actually frozen and emits MilestonesUnfrozen", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      const { escrow, treasury } = project;
      const start = await freezeNow(project);
      await networkHelpers.time.increase(10n * BigInt(DAY));

      const tx = await escrow.connect(treasury).unfreezeMilestones();
      const elapsed = (await blockTime(tx)) - start;

      await expect(tx).to.emit(escrow, "MilestonesUnfrozen").withArgs(elapsed);
      expect(elapsed).to.be.gte(10n * BigInt(DAY));
      expect(await escrow.totalFrozen()).to.equal(elapsed);
      expect(await escrow.isFrozen()).to.equal(false);
    });
  });

  describe("cumulative cap", function () {
    it("allows two full freezes and then reverts a third", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      const { escrow, treasury } = project;

      await freezeNow(project);
      await passFreeze();
      const second = await escrow.connect(treasury).freezeMilestones();
      await expect(second).to.emit(escrow, "MilestonesFrozen");
      expect(await escrow.totalFrozen()).to.equal(FREEZE);
      await passFreeze();

      await expect(escrow.connect(treasury).freezeMilestones()).to.be.revertedWith(
        "Freeze limit reached",
      );
      expect(await escrow.isFrozen()).to.equal(false);
    });

    it("clamps a freeze so the total never exceeds 90 days", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      const { escrow, treasury } = project;

      // 30 days actually frozen (early unfreeze), then one full 45-day freeze: 75 days used.
      await freezeNow(project);
      await networkHelpers.time.increase(30n * BigInt(DAY));
      await escrow.connect(treasury).unfreezeMilestones();
      const used = await escrow.totalFrozen();
      await freezeNow(project);
      await passFreeze();

      const remaining = MAX_TOTAL - used - FREEZE;
      const tx = await escrow.connect(treasury).freezeMilestones();
      const at = await blockTime(tx);

      await expect(tx).to.emit(escrow, "MilestonesFrozen").withArgs(at + remaining, MAX_TOTAL);
      expect(await escrow.frozenUntil()).to.equal(at + remaining);
      expect(remaining).to.be.lt(FREEZE);

      await networkHelpers.time.increase(remaining + 10n);
      expect(await escrow.isFrozen()).to.equal(false);
      await expect(escrow.connect(treasury).freezeMilestones()).to.be.revertedWith(
        "Freeze limit reached",
      );
    });

    it("lets an early unfreeze leave budget for later freezes", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      const { escrow, treasury } = project;

      for (let i = 0; i < 4; i++) {
        await freezeNow(project);
        await networkHelpers.time.increase(5n * BigInt(DAY));
        await escrow.connect(treasury).unfreezeMilestones();
      }

      expect(await escrow.totalFrozen()).to.be.gte(20n * BigInt(DAY));
      expect(await escrow.totalFrozen()).to.be.lt(21n * BigInt(DAY));
      await escrow.connect(treasury).freezeMilestones();
      expect(await escrow.isFrozen()).to.equal(true);
    });
  });

  describe("other paths keep working while frozen", function () {
    it("allows vote, voteBySig and stake", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      const { escrow, distributor, token, alice, bob, carol, outsider } = project;
      await freezeNow(project);

      await escrow.connect(alice).vote(true);

      const deadline = BigInt(await networkHelpers.time.latest()) + 3600n;
      const network = await ethers.provider.getNetwork();
      const signature = await bob.signTypedData(
        {
          name: "ForgeCapita MilestoneEscrow",
          version: "1",
          chainId: network.chainId,
          verifyingContract: await escrow.getAddress(),
        },
        VOTE_TYPES,
        { voter: bob.address, milestoneIndex: 0n, support: true, deadline },
      );
      await escrow.connect(outsider).voteBySig(bob.address, true, deadline, signature);
      expect((await escrow.milestones(0n)).yesVotes).to.equal(560n * ONE_TOKEN);

      await distributor.connect(carol).withdraw(240n * ONE_TOKEN);
      await token.connect(carol).approve(await distributor.getAddress(), 240n * ONE_TOKEN);
      await distributor.connect(carol).stake(240n * ONE_TOKEN);
      expect(await distributor.stakedBalance(carol.address)).to.equal(240n * ONE_TOKEN);
    });

    it("allows stakeWithPermit", async function () {
      const project = await networkHelpers.loadFixture(launchAndClaimProject);
      const { escrow, distributor, token, treasury, alice, outsider } = project;
      await escrow.connect(treasury).freezeMilestones();

      const deadline = BigInt(await networkHelpers.time.latest()) + 3600n;
      const network = await ethers.provider.getNetwork();
      const sig = ethers.Signature.from(
        await alice.signTypedData(
          {
            name: "Forge Project",
            version: "1",
            chainId: network.chainId,
            verifyingContract: await token.getAddress(),
          },
          PERMIT_TYPES,
          {
            owner: alice.address,
            spender: await distributor.getAddress(),
            value: 100n * ONE_TOKEN,
            nonce: await token.nonces(alice.address),
            deadline,
          },
        ),
      );
      await distributor
        .connect(outsider)
        .stakeWithPermit(alice.address, 100n * ONE_TOKEN, deadline, sig.v, sig.r, sig.s);
      expect(await distributor.stakedBalance(alice.address)).to.equal(100n * ONE_TOKEN);
    });

    it("allows claimTokens and claimTokensFor", async function () {
      const { escrow, token, treasury, alice, bob, outsider } =
        await networkHelpers.loadFixture(launchAndCloseProject);
      await escrow.connect(treasury).freezeMilestones();

      await escrow.connect(alice).claimTokens();
      await escrow.connect(outsider).claimTokensFor(bob.address);

      expect(await token.balanceOf(alice.address)).to.equal(320n * ONE_TOKEN);
      expect(await token.balanceOf(bob.address)).to.equal(240n * ONE_TOKEN);
    });

    it("allows cancelProject and refundDeadProject", async function () {
      const { escrow, token, treasury, developer, alice } =
        await networkHelpers.loadFixture(launchAndClaimProject);
      await escrow.connect(treasury).freezeMilestones();

      await escrow.connect(developer).cancelProject("stop");
      await token.connect(alice).approve(await escrow.getAddress(), 320n * ONE_TOKEN);
      await expect(escrow.connect(alice).refundDeadProject()).to.emit(escrow, "RefundClaimed");
    });

    it("lets the guardian shut down a frozen project", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      const { escrow, treasury } = project;
      await escrow.connect(treasury).freezeMilestones();
      await cancelAndWaitRefundWindow(project);

      await expect(escrow.connect(treasury).emergencyShutdown()).to.emit(
        escrow,
        "EmergencyShutdownTriggered",
      );
      expect(await escrow.projectCancelled()).to.equal(true);
    });
  });
});
