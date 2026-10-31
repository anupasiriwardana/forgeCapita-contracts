import { expect } from "chai";
import {
  DAY,
  DEVELOPER_SUPPLY,
  FUNDING_DURATION_DAYS,
  FUNDING_GOAL,
  MILESTONE_DESCRIPTIONS,
  MILESTONE_PERCENTAGES,
  ONE_TOKEN,
  TOTAL_SUPPLY,
  deployProtocol,
  ethers,
  etherDelta,
  launchAndClaimProject,
  launchAndCompleteProject,
  launchAndStartMilestoneProject,
  launchProject,
  networkHelpers,
} from "./helpers/protocol.js";
import { cancelAndWaitRefundWindow, eth } from "./helpers/extra.js";

const { time } = networkHelpers;
const WINDOW = BigInt(90 * DAY);
const VOTING_PERIOD = BigInt(28 * DAY);

type Claimed = Awaited<ReturnType<typeof launchAndClaimProject>>;

async function refundAll(project: Claimed): Promise<void> {
  const escrowAddress = await project.escrow.getAddress();
  for (const backer of [project.alice, project.bob, project.carol]) {
    const balance = await project.token.balanceOf(backer.address);
    await project.token.connect(backer).approve(escrowAddress, balance);
    await project.escrow.connect(backer).refundDeadProject();
  }
}

async function cancelledByDeveloper(): Promise<Claimed> {
  const project = await launchAndClaimProject();
  await project.escrow.connect(project.developer).cancelProject("stop");
  return project;
}

async function cancelledByGuardian(): Promise<Claimed> {
  const project = await launchAndClaimProject();
  await project.escrow.connect(project.treasury).cancelProject("stop");
  return project;
}

async function cancelledByFailedVote(): Promise<Claimed> {
  const project = await launchAndStartMilestoneProject();
  await time.increase(VOTING_PERIOD);
  await project.escrow.executeMilestone();
  return project;
}

describe("CON-02.27 locked masters", function () {
  it("rejects initialize() on every master", async function () {
    const { masterToken, masterEscrow, masterDistributor, masterRouter, outsider, registry } =
      await networkHelpers.loadFixture(deployProtocol);
    const registryAddress = await registry.getAddress();

    await expect(
      masterToken.connect(outsider).initialize("X", "X", 1n, outsider.address),
    ).to.be.revertedWithCustomError(masterToken, "InvalidInitialization");
    await expect(
      masterDistributor.connect(outsider).initialize(outsider.address, outsider.address, registryAddress),
    ).to.be.revertedWithCustomError(masterDistributor, "InvalidInitialization");
    await expect(
      masterRouter.connect(outsider).initialize(outsider.address, outsider.address, registryAddress),
    ).to.be.revertedWithCustomError(masterRouter, "InvalidInitialization");
    await expect(
      masterEscrow
        .connect(outsider)
        .initialize(
          outsider.address,
          outsider.address,
          TOTAL_SUPPLY,
          MILESTONE_DESCRIPTIONS,
          MILESTONE_PERCENTAGES,
          FUNDING_GOAL,
          FUNDING_DURATION_DAYS,
          registryAddress,
          outsider.address,
        ),
    ).to.be.revertedWithCustomError(masterEscrow, "InvalidInitialization");
  });

  it("still initialises factory clones, and the clones cannot be initialised again", async function () {
    const { token, escrow, distributor, router, registry, developer, outsider } =
      await networkHelpers.loadFixture(launchProject);
    const registryAddress = await registry.getAddress();

    expect(await token.name()).to.equal("Forge Project");
    expect(await escrow.developer()).to.equal(developer.address);
    expect(await escrow.publicSupply()).to.equal(800n * ONE_TOKEN);
    expect(await distributor.milestoneEscrow()).to.equal(await escrow.getAddress());
    expect(await router.milestoneEscrow()).to.equal(await escrow.getAddress());

    await expect(
      token.connect(outsider).initialize("X", "X", 1n, outsider.address),
    ).to.be.revertedWithCustomError(token, "InvalidInitialization");
    await expect(
      distributor.connect(outsider).initialize(outsider.address, outsider.address, registryAddress),
    ).to.be.revertedWithCustomError(distributor, "InvalidInitialization");
    await expect(
      router.connect(outsider).initialize(outsider.address, outsider.address, registryAddress),
    ).to.be.revertedWithCustomError(router, "InvalidInitialization");
    await expect(
      escrow
        .connect(outsider)
        .initialize(
          outsider.address,
          outsider.address,
          TOTAL_SUPPLY,
          MILESTONE_DESCRIPTIONS,
          MILESTONE_PERCENTAGES,
          FUNDING_GOAL,
          FUNDING_DURATION_DAYS,
          registryAddress,
          outsider.address,
        ),
    ).to.be.revertedWithCustomError(escrow, "InvalidInitialization");
  });
});

describe("CON-02.28 emergency shutdown after a cancel", function () {
  it("exposes REFUND_WINDOW of 90 days and no cancelledAt before any cancel", async function () {
    const { escrow } = await networkHelpers.loadFixture(launchAndClaimProject);

    expect(await escrow.REFUND_WINDOW()).to.equal(WINDOW);
    expect(await escrow.cancelledAt()).to.equal(0n);
  });

  describe("cancelledAt", function () {
    for (const [label, fixture] of [
      ["developer cancel", cancelledByDeveloper],
      ["guardian cancel", cancelledByGuardian],
      ["failed vote", cancelledByFailedVote],
    ] as const) {
      it(`is set by a ${label}`, async function () {
        const { escrow } = await networkHelpers.loadFixture(fixture);

        expect(await escrow.cancelledAt()).to.equal(BigInt(await time.latest()));
      });
    }

    it("is set by the shutdown of a project that was not cancelled", async function () {
      const { escrow, treasury } = await networkHelpers.loadFixture(launchAndCompleteProject);
      await escrow.connect(treasury).emergencyShutdown();

      expect(await escrow.cancelledAt()).to.equal(BigInt(await time.latest()));
    });

    it("is not moved by a later shutdown of a cancelled project", async function () {
      const { escrow, treasury } = await networkHelpers.loadFixture(cancelledByDeveloper);
      const at = await escrow.cancelledAt();
      await time.increase(WINDOW);
      await escrow.connect(treasury).emergencyShutdown();

      expect(await escrow.cancelledAt()).to.equal(at);
    });
  });

  for (const [label, fixture] of [
    ["developer cancel", cancelledByDeveloper],
    ["guardian cancel", cancelledByGuardian],
    ["failed-vote cancel", cancelledByFailedVote],
  ] as const) {
    describe(`after a ${label}`, function () {
      it("reverts with 'Refunds still open' while public tokens are outstanding", async function () {
        const { escrow, treasury } = await networkHelpers.loadFixture(fixture);

        await expect(escrow.connect(treasury).emergencyShutdown()).to.be.revertedWith(
          "Refunds still open",
        );
        await time.increase(WINDOW - 100n);
        await expect(escrow.connect(treasury).emergencyShutdown()).to.be.revertedWith(
          "Refunds still open",
        );
      });

      it("works after 90 days even though refunds are outstanding", async function () {
        const { escrow, token, treasury } = await networkHelpers.loadFixture(fixture);
        await time.increase(WINDOW);

        await expect(escrow.connect(treasury).emergencyShutdown()).to.emit(
          escrow,
          "EmergencyShutdownTriggered",
        );
        expect(await token.isInvalidated()).to.equal(true);
        expect(await escrow.remainingPublicTokens()).to.equal(800n * ONE_TOKEN);
      });
    });
  }

  it("works before 90 days once every public token is refunded, and burns what the refunds left", async function () {
    const project = await networkHelpers.loadFixture(cancelledByDeveloper);
    const { escrow, token, treasury } = project;
    await refundAll(project);
    expect(await escrow.remainingPublicTokens()).to.equal(0n);
    const escrowTokens = await token.balanceOf(await escrow.getAddress());
    expect(escrowTokens).to.equal(800n * ONE_TOKEN + DEVELOPER_SUPPLY);

    await expect(escrow.connect(treasury).emergencyShutdown())
      .to.emit(escrow, "EmergencyShutdownTriggered")
      .withArgs(0n, escrowTokens);

    expect(await token.balanceOf(await escrow.getAddress())).to.equal(0n);
    expect(await token.totalSupply()).to.equal(0n);
    expect(await token.isInvalidated()).to.equal(true);
  });

  it("still reverts one second before the window ends and works exactly at cancelledAt + REFUND_WINDOW", async function () {
    const { escrow, treasury } = await networkHelpers.loadFixture(cancelledByGuardian);
    const at = await escrow.cancelledAt();

    await time.increaseTo(at + WINDOW - 2n);
    await expect(escrow.connect(treasury).emergencyShutdown()).to.be.revertedWith(
      "Refunds still open",
    );

    await time.setNextBlockTimestamp(at + WINDOW);
    await expect(escrow.connect(treasury).emergencyShutdown()).to.emit(
      escrow,
      "EmergencyShutdownTriggered",
    );
  });

  it("sweeps and invalidates a cancelled project once the window has passed", async function () {
    const project = await networkHelpers.loadFixture(launchAndClaimProject);
    const { escrow, token, treasury } = project;
    await cancelAndWaitRefundWindow(project);
    const escrowAddress = await escrow.getAddress();
    const balance = await ethers.provider.getBalance(escrowAddress);

    const delta = await etherDelta(treasury.address, () => escrow.connect(treasury).emergencyShutdown());

    expect(delta).to.equal(balance);
    expect(balance).to.equal(eth("9.5"));
    expect(await ethers.provider.getBalance(escrowAddress)).to.equal(0n);
    expect(await token.isInvalidated()).to.equal(true);
    expect(await token.balanceOf(escrowAddress)).to.equal(0n);
    expect(await token.totalSupply()).to.equal(800n * ONE_TOKEN);
    expect(await escrow.projectCancelled()).to.equal(true);
  });

  it("emits the swept balance and burned tokens, and sweeps exactly that after a window", async function () {
    const { escrow, token, treasury } = await networkHelpers.loadFixture(cancelledByDeveloper);
    const escrowAddress = await escrow.getAddress();
    const balance = await ethers.provider.getBalance(escrowAddress);
    const escrowTokens = await token.balanceOf(escrowAddress);
    await time.increase(WINDOW);

    const tx = escrow.connect(treasury).emergencyShutdown();

    await expect(tx).to.emit(escrow, "EmergencyShutdownTriggered").withArgs(balance, escrowTokens);
    expect(await ethers.provider.getBalance(escrowAddress)).to.equal(0n);
  });

  it("reverts a second shutdown with 'Already shut down' after both kinds", async function () {
    const plain = await networkHelpers.loadFixture(launchAndCompleteProject);
    await plain.escrow.connect(plain.treasury).emergencyShutdown();
    await expect(plain.escrow.connect(plain.treasury).emergencyShutdown()).to.be.revertedWith(
      "Already shut down",
    );

    const cancelled = await networkHelpers.loadFixture(cancelledByDeveloper);
    await time.increase(WINDOW);
    await cancelled.escrow.connect(cancelled.treasury).emergencyShutdown();
    await expect(
      cancelled.escrow.connect(cancelled.treasury).emergencyShutdown(),
    ).to.be.revertedWith("Already shut down");
  });

  it("checks 'Already shut down' before 'Refunds still open'", async function () {
    const { escrow, treasury } = await networkHelpers.loadFixture(launchAndCompleteProject);
    await escrow.connect(treasury).emergencyShutdown();

    // projectCancelled is now true and 90 days have not passed, yet the first check wins
    await expect(escrow.connect(treasury).emergencyShutdown()).to.be.revertedWith(
      "Already shut down",
    );
  });

  it("is guardian only, also on a cancelled project", async function () {
    const { escrow, developer, alice, outsider } = await networkHelpers.loadFixture(cancelledByDeveloper);
    await time.increase(WINDOW);

    for (const caller of [developer, alice, outsider]) {
      await expect(escrow.connect(caller).emergencyShutdown()).to.be.revertedWith(
        "Only Guardian can trigger emergency shutdown",
      );
    }
  });

  it("keeps refundDeadProject working until the shutdown and blocks it after", async function () {
    const project = await networkHelpers.loadFixture(cancelledByDeveloper);
    const { escrow, token, treasury, alice, bob } = project;
    const escrowAddress = await escrow.getAddress();
    await token.connect(alice).approve(escrowAddress, 320n * ONE_TOKEN);
    await escrow.connect(alice).refundDeadProject();
    await time.increase(WINDOW);
    await escrow.connect(treasury).emergencyShutdown();

    await expect(escrow.connect(bob).refundDeadProject()).to.be.revertedWith(
      "Token is dead (Emergency Shutdown)",
    );
  });
});

describe("CON-02.29 ProjectToken.burn is owner only", function () {
  it("is owned by the escrow clone after the factory flow", async function () {
    const { token, escrow, factory } = await networkHelpers.loadFixture(launchProject);

    expect(await token.owner()).to.equal(await escrow.getAddress());
    expect(await token.owner()).to.not.equal(await factory.getAddress());
  });

  it("lets the owner (the escrow) burn", async function () {
    const { token, escrow } = await networkHelpers.loadFixture(launchAndClaimProject);
    const escrowAddress = await escrow.getAddress();
    await networkHelpers.impersonateAccount(escrowAddress);
    await networkHelpers.setBalance(escrowAddress, eth("10"));
    const escrowSigner = await ethers.getSigner(escrowAddress);
    const before = await token.totalSupply();

    await token.connect(escrowSigner).burn(10n * ONE_TOKEN);

    expect(await token.totalSupply()).to.equal(before - 10n * ONE_TOKEN);
    expect(await token.balanceOf(escrowAddress)).to.equal(DEVELOPER_SUPPLY - 10n * ONE_TOKEN);
  });

  it("reverts for a holder, the developer, the guardian and a stranger", async function () {
    const { token, developer, treasury, alice, outsider } =
      await networkHelpers.loadFixture(launchAndClaimProject);

    for (const caller of [alice, developer, treasury, outsider]) {
      await expect(token.connect(caller).burn(1n)).to.be.revertedWithCustomError(
        token,
        "OwnableUnauthorizedAccount",
      );
    }
    expect(await token.balanceOf(alice.address)).to.equal(320n * ONE_TOKEN);
  });

  it("still lets emergencyShutdown burn the escrow-held tokens", async function () {
    const project = await networkHelpers.loadFixture(launchAndClaimProject);
    const { token, escrow, treasury } = project;
    const escrowAddress = await escrow.getAddress();
    expect(await token.balanceOf(escrowAddress)).to.equal(DEVELOPER_SUPPLY);
    await cancelAndWaitRefundWindow(project);

    await expect(escrow.connect(treasury).emergencyShutdown())
      .to.emit(escrow, "EmergencyShutdownTriggered")
      .withArgs(eth("9.5"), DEVELOPER_SUPPLY);

    expect(await token.balanceOf(escrowAddress)).to.equal(0n);
    expect(await token.totalSupply()).to.equal(800n * ONE_TOKEN);
  });

  it("leaves the refund maths unaffected: every holder gets its pro-rata share and the escrow empties", async function () {
    const project = await networkHelpers.loadFixture(cancelledByDeveloper);
    const { escrow, token, alice, bob, carol } = project;
    await expect(token.connect(alice).burn(1n)).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    const escrowAddress = await escrow.getAddress();
    const paid: bigint[] = [];

    for (const backer of [alice, bob, carol]) {
      const balance = await token.balanceOf(backer.address);
      await token.connect(backer).approve(escrowAddress, balance);
      paid.push(await etherDelta(backer.address, () => escrow.connect(backer).refundDeadProject()));
    }

    expect(paid[0]).to.equal(eth("3.8"));
    expect(paid[1]).to.equal(eth("2.85"));
    expect(paid[2]).to.equal(eth("2.85"));
    expect(await ethers.provider.getBalance(escrowAddress)).to.equal(0n);
  });
});
