import { expect } from "chai";
import {
  DEVELOPER_SUPPLY,
  ethers,
  etherDelta,
  launchAndCloseProject,
  launchAndFundProject,
  networkHelpers,
  sendEth,
  approveCurrentMilestone,
} from "./helpers/protocol.js";

const eth = ethers.parseEther;
const BPS = 10_000n;
const CLAIM = 0;
const STAKE = 1;
const VOTE = 2;
const EXECUTE = 3;

type Project = Awaited<ReturnType<typeof launchAndCloseProject>>;

const PERMIT_TYPES = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

const VOTE_TYPES = {
  Vote: [
    { name: "voter", type: "address" },
    { name: "milestoneIndex", type: "uint256" },
    { name: "support", type: "bool" },
    { name: "deadline", type: "uint256" },
  ],
};

/**
 * Closed project (budget 0.5 ETH, net funds 9.5 ETH, ceiling 0.5 + 1.425 = 1.925 ETH) where
 * `outsider` is an allow-listed relayer. Every action has a 1 ETH surcharge, so with a per-action
 * cap of at most 1 ETH each relayer-sponsored action costs exactly the cap.
 */
async function relayedClosedProject(): Promise<Project> {
  const project = await launchAndCloseProject();
  await configureRelayer(project);
  return project;
}

async function relayedDustProject(): Promise<Project> {
  const project = await launchAndFundProject();
  await sendEth(project.alice, await project.escrow.getAddress(), 7n);
  await project.escrow.connect(project.developer).closeFundingAndStart();
  await configureRelayer(project);
  return project;
}

async function configureRelayer(project: Project): Promise<void> {
  const registry = project.registry.connect(project.treasury);
  await registry.setRelayer(project.outsider.address, true);
  for (const action of [CLAIM, STAKE, VOTE, EXECUTE]) {
    await registry.setL1Surcharge(action, eth("1"));
  }
}

async function setCap(project: Project, value: bigint): Promise<void> {
  await project.registry.connect(project.treasury).setMaxCostPerAction(value);
}

async function relayClaim(project: Project, account: Project["alice"]) {
  return project.escrow.connect(project.outsider).claimTokensFor(account.address);
}

/** Backers claim anything not yet claimed, stake everything and milestone 0 voting opens. */
async function stakeAndStart(project: Project): Promise<void> {
  const distributorAddress = await project.distributor.getAddress();
  for (const backer of [project.alice, project.bob, project.carol]) {
    if (!(await project.escrow.hasClaimedTokens(backer.address))) {
      await project.escrow.connect(backer).claimTokens();
    }
    const balance = await project.token.balanceOf(backer.address);
    await project.token.connect(backer).approve(distributorAddress, balance);
    await project.distributor.connect(backer).stake(balance);
  }
  await project.escrow.connect(project.developer).startMilestone(0);
}

async function executeAsAnyone(project: Project) {
  await approveCurrentMilestone(project);
  return project.escrow.connect(project.deployer).executeMilestone();
}

async function nextMilestone(project: Project, index: number) {
  await project.escrow.connect(project.developer).startMilestone(index);
  return executeAsAnyone(project);
}

describe("Gas ledger", function () {
  describe("initialisation", function () {
    it("sets the budget to the platform fee when funding closes", async function () {
      const { escrow } = await networkHelpers.loadFixture(launchAndCloseProject);

      expect(await escrow.gasBudget()).to.equal(eth("0.5"));
      expect(await escrow.gasSpent()).to.equal(0n);
      expect(await escrow.gasRecovered()).to.equal(0n);
      expect(await escrow.MAX_DEBT_BPS()).to.equal(1500n);
    });

    it("has no budget before funding closes", async function () {
      const { escrow } = await networkHelpers.loadFixture(launchAndFundProject);

      expect(await escrow.gasBudget()).to.equal(0n);
    });

    it("never lets a relayer record cost before funding closes (ceiling is zero)", async function () {
      const project = await networkHelpers.loadFixture(launchAndFundProject);
      await configureRelayer(project);
      await setCap(project, eth("0.1"));

      await expect(
        project.escrow.connect(project.outsider).claimTokensFor(project.alice.address),
      ).to.be.revertedWith("Funding phase is still active");
      expect(await project.escrow.gasSpent()).to.equal(0n);
    });
  });

  describe("cost recording", function () {
    it("records a relayer claim, emits SponsoredGas and caps the cost at maxCostPerAction", async function () {
      const project = await networkHelpers.loadFixture(relayedClosedProject);
      await setCap(project, eth("0.1"));

      await expect(relayClaim(project, project.alice))
        .to.emit(project.escrow, "SponsoredGas")
        .withArgs(project.outsider.address, project.alice.address, CLAIM, eth("0.1"), eth("0.1"));
      expect(await project.escrow.gasSpent()).to.equal(eth("0.1"));
      expect(await project.token.balanceOf(project.alice.address)).to.equal(320n * 10n ** 18n);
    });

    it("measures gas times gas price when the cap and surcharge are out of the way", async function () {
      const project = await networkHelpers.loadFixture(relayedClosedProject);
      await project.registry.connect(project.treasury).setL1Surcharge(CLAIM, 0n);
      await setCap(project, eth("1"));

      const tx = await relayClaim(project, project.alice);
      const receipt = await tx.wait();
      if (receipt === null) throw new Error("receipt missing");
      const spent = await project.escrow.gasSpent();

      expect(spent >= 21000n * receipt.gasPrice).to.equal(true);
      expect(spent < eth("1")).to.equal(true);
    });

    it("adds the per-action l1 surcharge", async function () {
      const project = await networkHelpers.loadFixture(relayedClosedProject);
      await project.registry.connect(project.treasury).setL1Surcharge(CLAIM, eth("0.2"));
      await setCap(project, eth("1"));

      await relayClaim(project, project.alice);
      const spent = await project.escrow.gasSpent();

      expect(spent >= eth("0.2")).to.equal(true);
      expect(spent < eth("0.21")).to.equal(true);
    });

    it("records nothing for a caller that is not an allow-listed relayer", async function () {
      const project = await networkHelpers.loadFixture(relayedClosedProject);
      await setCap(project, eth("0.1"));

      await expect(project.escrow.connect(project.bob).claimTokensFor(project.alice.address)).to.not.emit(
        project.escrow,
        "SponsoredGas",
      );
      await project.escrow.connect(project.carol).claimTokens();
      expect(await project.escrow.gasSpent()).to.equal(0n);
    });

    it("stops recording when the relayer is removed mid-project", async function () {
      const project = await networkHelpers.loadFixture(relayedClosedProject);
      await setCap(project, eth("0.1"));
      await relayClaim(project, project.alice);
      await project.registry.connect(project.treasury).setRelayer(project.outsider.address, false);

      await expect(relayClaim(project, project.bob)).to.not.emit(project.escrow, "SponsoredGas");
      expect(await project.escrow.gasSpent()).to.equal(eth("0.1"));
      expect(await project.escrow.hasClaimedTokens(project.bob.address)).to.equal(true);
    });

    it("records a relayer-submitted vote signature", async function () {
      const project = await networkHelpers.loadFixture(relayedClosedProject);
      await setCap(project, eth("0.1"));
      await stakeAndStart(project);
      const { chainId } = await ethers.provider.getNetwork();
      const deadline = BigInt(await networkHelpers.time.latest()) + 3600n;
      const signature = await project.alice.signTypedData(
        {
          name: "ForgeCapita MilestoneEscrow",
          version: "1",
          chainId,
          verifyingContract: await project.escrow.getAddress(),
        },
        VOTE_TYPES,
        { voter: project.alice.address, milestoneIndex: 0n, support: true, deadline },
      );

      await expect(
        project.escrow
          .connect(project.outsider)
          .voteBySig(project.alice.address, true, deadline, signature),
      )
        .to.emit(project.escrow, "SponsoredGas")
        .withArgs(project.outsider.address, project.alice.address, VOTE, eth("0.1"), eth("0.1"));
    });

    it("records a relayer-submitted stakeWithPermit in the escrow, and nothing for others", async function () {
      const project = await networkHelpers.loadFixture(relayedClosedProject);
      await setCap(project, eth("0.1"));
      await project.escrow.connect(project.alice).claimTokens();
      await project.escrow.connect(project.bob).claimTokens();
      const { chainId } = await ethers.provider.getNetwork();
      const spender = await project.distributor.getAddress();
      const deadline = BigInt(await networkHelpers.time.latest()) + 3600n;
      const permitFor = async (signer: Project["alice"], value: bigint) => {
        const sig = await signer.signTypedData(
          {
            name: "Forge Project",
            version: "1",
            chainId,
            verifyingContract: await project.token.getAddress(),
          },
          PERMIT_TYPES,
          {
            owner: signer.address,
            spender,
            value,
            nonce: await project.token.nonces(signer.address),
            deadline,
          },
        );
        return ethers.Signature.from(sig);
      };
      const amount = 100n * 10n ** 18n;

      const aliceSig = await permitFor(project.alice, amount);
      await expect(
        project.distributor
          .connect(project.outsider)
          .stakeWithPermit(project.alice.address, amount, deadline, aliceSig.v, aliceSig.r, aliceSig.s),
      )
        .to.emit(project.escrow, "SponsoredGas")
        .withArgs(project.outsider.address, project.alice.address, STAKE, eth("0.1"), eth("0.1"));
      expect(await project.escrow.gasSpent()).to.equal(eth("0.1"));

      const bobSig = await permitFor(project.bob, amount);
      await project.distributor
        .connect(project.carol)
        .stakeWithPermit(project.bob.address, amount, deadline, bobSig.v, bobSig.r, bobSig.s);
      expect(await project.escrow.gasSpent()).to.equal(eth("0.1"));
    });

    it("only accepts recordSponsoredGas from the project's distributor", async function () {
      const project = await networkHelpers.loadFixture(relayedClosedProject);

      for (const caller of [project.outsider, project.treasury, project.developer, project.alice]) {
        await expect(
          project.escrow
            .connect(caller)
            .recordSponsoredGas(project.outsider.address, project.alice.address, STAKE, 1n),
        ).to.be.revertedWith("Only distributor");
      }
      expect(await project.escrow.gasSpent()).to.equal(0n);
    });
  });

  describe("exposure ceiling", function () {
    it("allows spending exactly up to budget + 15% of net funds and reverts beyond", async function () {
      const project = await networkHelpers.loadFixture(relayedClosedProject);
      await setCap(project, eth("0.9625"));

      await relayClaim(project, project.alice);
      await relayClaim(project, project.bob);
      expect(await project.escrow.gasSpent()).to.equal(eth("1.925"));

      await expect(relayClaim(project, project.carol)).to.be.revertedWith("Gas ceiling exceeded");
      expect(await project.escrow.gasSpent()).to.equal(eth("1.925"));
      expect(await project.escrow.hasClaimedTokens(project.carol.address)).to.equal(false);
      await project.escrow.connect(project.carol).claimTokens();
    });

    it("lets a user execute a milestone themselves when the relayer would exceed the ceiling", async function () {
      const project = await networkHelpers.loadFixture(relayedClosedProject);
      await setCap(project, eth("0.9625"));
      await relayClaim(project, project.alice);
      await relayClaim(project, project.bob);
      await stakeAndStart(project);
      await approveCurrentMilestone(project);

      await expect(project.escrow.connect(project.outsider).executeMilestone()).to.be.revertedWith(
        "Gas ceiling exceeded",
      );
      await expect(project.escrow.connect(project.deployer).executeMilestone()).to.emit(
        project.escrow,
        "MilestoneExecuted",
      );
    });
  });

  describe("recovery in executeMilestone", function () {
    it("makes no deduction while spending stays under budget", async function () {
      const project = await networkHelpers.loadFixture(relayedClosedProject);
      await setCap(project, eth("0.1"));
      for (const account of [project.alice, project.bob, project.carol]) {
        await relayClaim(project, account);
      }
      await stakeAndStart(project);

      await approveCurrentMilestone(project);
      await expect(project.escrow.connect(project.deployer).executeMilestone())
        .to.emit(project.escrow, "MilestoneExecuted")
        .withArgs(0n, eth("3.8"), 0n, 0n);
      expect(await project.escrow.gasRecovered()).to.equal(0n);
    });

    it("makes no deduction when spending equals the budget exactly", async function () {
      const project = await networkHelpers.loadFixture(relayedClosedProject);
      await setCap(project, eth("0.25"));
      await relayClaim(project, project.alice);
      await relayClaim(project, project.bob);
      expect(await project.escrow.gasSpent()).to.equal(await project.escrow.gasBudget());
      await stakeAndStart(project);

      await approveCurrentMilestone(project);
      const tx = project.escrow.connect(project.deployer).executeMilestone();
      await expect(tx).to.emit(project.escrow, "MilestoneExecuted").withArgs(0n, eth("3.8"), 0n, 0n);
      await expect(tx).to.not.emit(project.escrow, "GasDebtRecovered");
    });

    it("deducts the overflow from the payout and reports it", async function () {
      const project = await networkHelpers.loadFixture(relayedClosedProject);
      await setCap(project, eth("0.25"));
      for (const account of [project.alice, project.bob, project.carol]) {
        await relayClaim(project, account);
      }
      await stakeAndStart(project);
      await approveCurrentMilestone(project);

      const tx = project.escrow.connect(project.deployer).executeMilestone();

      await expect(tx)
        .to.emit(project.escrow, "MilestoneExecuted")
        .withArgs(0n, eth("3.55"), 0n, eth("0.25"));
      await expect(tx).to.emit(project.escrow, "GasDebtRecovered").withArgs(0n, eth("0.25"), 0n);
      expect(await project.escrow.gasRecovered()).to.equal(eth("0.25"));
    });

    it("pays the deduction to the treasury", async function () {
      const project = await networkHelpers.loadFixture(relayedClosedProject);
      await setCap(project, eth("0.25"));
      for (const account of [project.alice, project.bob, project.carol]) {
        await relayClaim(project, account);
      }
      await stakeAndStart(project);
      await approveCurrentMilestone(project);

      const delta = await etherDelta(project.treasury.address, () =>
        project.escrow.connect(project.deployer).executeMilestone(),
      );

      expect(delta).to.equal(eth("0.25"));
    });

    it("pays the developer the payout minus the deduction", async function () {
      const project = await networkHelpers.loadFixture(relayedClosedProject);
      await setCap(project, eth("0.25"));
      for (const account of [project.alice, project.bob, project.carol]) {
        await relayClaim(project, account);
      }
      await stakeAndStart(project);
      await approveCurrentMilestone(project);

      const delta = await etherDelta(project.developer.address, () =>
        project.escrow.connect(project.deployer).executeMilestone(),
      );

      expect(delta).to.equal(eth("3.55"));
    });

    it("counts the cost of a relayer-submitted executeMilestone before computing the deduction", async function () {
      const project = await networkHelpers.loadFixture(relayedClosedProject);
      await setCap(project, eth("0.3"));
      await relayClaim(project, project.alice);
      await relayClaim(project, project.bob);
      await stakeAndStart(project);
      await approveCurrentMilestone(project);

      const tx = project.escrow.connect(project.outsider).executeMilestone();

      await expect(tx)
        .to.emit(project.escrow, "SponsoredGas")
        .withArgs(project.outsider.address, ethers.ZeroAddress, EXECUTE, eth("0.3"), eth("0.9"));
      await expect(tx)
        .to.emit(project.escrow, "MilestoneExecuted")
        .withArgs(0n, eth("3.4"), 0n, eth("0.4"));
    });

    it("limits a deduction to 15% of the payout and carries the rest to the next milestone", async function () {
      const project = await networkHelpers.loadFixture(relayedClosedProject);
      await setCap(project, eth("0.4"));
      for (const account of [project.alice, project.bob, project.carol]) {
        await relayClaim(project, account);
      }
      await stakeAndStart(project);

      await expect(executeAsAnyone(project))
        .to.emit(project.escrow, "MilestoneExecuted")
        .withArgs(0n, eth("3.23"), 0n, eth("0.57"));
      expect(await project.escrow.gasRecovered()).to.equal(eth("0.57"));

      const second = nextMilestone(project, 1);
      await expect(second)
        .to.emit(project.escrow, "GasDebtRecovered")
        .withArgs(1n, eth("0.13"), 0n);
      await expect(second)
        .to.emit(project.escrow, "MilestoneExecuted")
        .withArgs(1n, eth("5.57"), DEVELOPER_SUPPLY, eth("0.13"));
      expect(await project.escrow.gasRecovered()).to.equal(eth("0.7"));
    });

    it("writes off what is left after the final milestone and keeps the developer vesting", async function () {
      const project = await networkHelpers.loadFixture(relayedDustProject);
      const { escrow } = project;
      // net funds carry 7 wei of dust, so the floored per-milestone caps sum to 1 wei below the ceiling
      const ceilingExtra = ((await escrow.netFunds()) * 1500n) / BPS;
      const target = (await escrow.gasBudget()) + ceilingExtra;
      await setCap(project, eth("1"));
      await relayClaim(project, project.alice);
      await setCap(project, target - eth("1"));
      await relayClaim(project, project.bob);
      expect(await escrow.gasSpent()).to.equal(target);
      await stakeAndStart(project);

      const releaseFirst = ((await escrow.netFunds()) * 40n) / 100n;
      const releaseSecond = ((await escrow.netFunds()) * 60n) / 100n;
      const capFirst = (releaseFirst * 1500n) / BPS;
      const capSecond = (releaseSecond * 1500n) / BPS;
      const writtenOff = ceilingExtra - capFirst - capSecond;
      expect(writtenOff).to.equal(1n);

      await executeAsAnyone(project);
      const last = nextMilestone(project, 1);

      await expect(last).to.emit(escrow, "GasDebtWrittenOff").withArgs(writtenOff);
      await expect(last)
        .to.emit(escrow, "MilestoneExecuted")
        .withArgs(1n, releaseSecond - capSecond, DEVELOPER_SUPPLY, capSecond);
      expect(await escrow.gasRecovered()).to.equal(capFirst + capSecond);
      expect(await project.token.balanceOf(project.developer.address)).to.equal(DEVELOPER_SUPPLY);
      expect(await escrow.completed()).to.equal(true);
    });

    it("does not emit a write-off when everything was recovered", async function () {
      const project = await networkHelpers.loadFixture(relayedClosedProject);
      await setCap(project, eth("0.4"));
      for (const account of [project.alice, project.bob, project.carol]) {
        await relayClaim(project, account);
      }
      await stakeAndStart(project);
      await executeAsAnyone(project);

      await expect(nextMilestone(project, 1)).to.not.emit(project.escrow, "GasDebtWrittenOff");
    });
  });

  describe("permissionless execution", function () {
    it("lets any account execute an approved milestone", async function () {
      const project = await networkHelpers.loadFixture(relayedClosedProject);
      await stakeAndStart(project);
      await approveCurrentMilestone(project);

      await expect(project.escrow.connect(project.carol).executeMilestone()).to.emit(
        project.escrow,
        "MilestoneExecuted",
      );
    });

    it("no longer has the signature-based selector", async function () {
      const { escrow } = await networkHelpers.loadFixture(relayedClosedProject);
      const oldSelector = ethers.id("executeMilestone(uint256,bytes)").slice(0, 10);

      expect(escrow.interface.getFunction("executeMilestone(uint256,bytes)")).to.equal(null);
      await expect(
        ethers.provider.call({
          to: await escrow.getAddress(),
          data: oldSelector + "0".repeat(64 * 4),
        }),
      ).to.be.rejected;
    });
  });
});
