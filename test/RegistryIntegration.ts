import { expect } from "chai";
import {
  etherDelta,
  ethers,
  launchAndClaimProject,
  launchAndFundProject,
  launchAndStartMilestoneProject,
  launchProject,
  networkHelpers,
} from "./helpers/protocol.js";

type Project = Awaited<ReturnType<typeof launchProject>>;

async function rotateTreasury(
  registry: Project["registry"],
  current: Project["treasury"],
  next: Project["outsider"],
) {
  await registry.connect(current).proposeTreasury(next.address);
  await registry.connect(next).acceptTreasury();
}

async function rotateGuardian(
  registry: Project["registry"],
  current: Project["treasury"],
  next: Project["outsider"],
) {
  await registry.connect(current).proposeGuardian(next.address);
  await registry.connect(next).acceptGuardian();
}

describe("Registry integration", function () {
  describe("wiring", function () {
    it("passes the registry to every contract", async function () {
      const { registry, factory, escrow, distributor, router, p2p } =
        await networkHelpers.loadFixture(launchProject);
      const registryAddress = await registry.getAddress();

      expect(await factory.registry()).to.equal(registryAddress);
      expect(await escrow.registry()).to.equal(registryAddress);
      expect(await distributor.registry()).to.equal(registryAddress);
      expect(await router.registry()).to.equal(registryAddress);
      expect(await p2p.registry()).to.equal(registryAddress);
    });
  });

  describe("treasury rotation", function () {
    it("is visible through every treasury view", async function () {
      const { registry, treasury, factory, escrow, router, p2p, outsider } =
        await networkHelpers.loadFixture(launchProject);
      await rotateTreasury(registry, treasury, outsider);

      expect(await escrow.forgeCapitaTreasury()).to.equal(outsider.address);
      expect(await router.forgeCapitaTreasury()).to.equal(outsider.address);
      expect(await factory.forgeCapitaTreasury()).to.equal(outsider.address);
      expect(await p2p.treasury()).to.equal(outsider.address);
    });

    it("sends the escrow platform fee to the new treasury", async function () {
      const { registry, treasury, escrow, developer, outsider } =
        await networkHelpers.loadFixture(launchAndFundProject);
      await rotateTreasury(registry, treasury, outsider);

      const delta = await etherDelta(outsider.address, () =>
        escrow.connect(developer).closeFundingAndStart(),
      );
      expect(delta).to.equal(ethers.parseEther("0.5"));
    });

    it("pays a gas-debt deduction to the new treasury", async function () {
      const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
      const { registry, treasury, escrow, alice, bob, outsider, carol } = project;
      await registry.connect(treasury).setRelayer(carol.address, true);
      await registry.connect(treasury).setMaxCostPerAction(ethers.parseEther("1"));
      // the 0.5 ETH budget is exceeded by the 0.6 ETH Execute surcharge alone
      await registry.connect(treasury).setL1Surcharge(3, ethers.parseEther("0.6"));
      await escrow.connect(alice).vote(true);
      await escrow.connect(bob).vote(true);
      await rotateTreasury(registry, treasury, outsider);

      const delta = await etherDelta(outsider.address, () => escrow.connect(carol).executeMilestone());

      const overflow = (await escrow.gasSpent()) - (await escrow.gasBudget());
      expect(overflow > ethers.parseEther("0.1")).to.equal(true);
      expect(delta).to.equal(overflow);
    });

    it("sends router treasury funds to the new treasury", async function () {
      const { registry, treasury, router, alice, outsider } =
        await networkHelpers.loadFixture(launchProject);
      await router.connect(alice).routePayment({ value: ethers.parseEther("1") });
      await rotateTreasury(registry, treasury, outsider);

      const delta = await etherDelta(outsider.address, () => router.claimTreasuryFunds());
      expect(delta).to.equal(ethers.parseEther("0.01"));
    });

    it("sends the P2P fee to the new treasury", async function () {
      const { registry, treasury, p2p, token, alice, bob, outsider } =
        await networkHelpers.loadFixture(launchAndClaimProject);
      await rotateTreasury(registry, treasury, outsider);
      const amount = await token.balanceOf(alice.address);
      await token.connect(alice).approve(await p2p.getAddress(), amount);
      await p2p
        .connect(alice)
        .createListing(await token.getAddress(), amount, ethers.parseEther("2"));

      const delta = await etherDelta(outsider.address, () =>
        p2p.connect(bob).fillListing(0, { value: ethers.parseEther("2") }),
      );
      expect(delta).to.equal(ethers.parseEther("0.02"));
    });

    it("sweeps an emergency shutdown to the new treasury", async function () {
      const { registry, treasury, escrow, carol, outsider } =
        await networkHelpers.loadFixture(launchAndClaimProject);
      await rotateTreasury(registry, treasury, outsider);
      await rotateGuardian(registry, treasury, carol);

      const delta = await etherDelta(outsider.address, () =>
        escrow.connect(carol).emergencyShutdown(),
      );
      expect(delta).to.equal(ethers.parseEther("9.5"));
    });
  });

  describe("guardian rotation", function () {
    it("stops the old guardian and enables the new one to shut down", async function () {
      const { registry, escrow, treasury, outsider } =
        await networkHelpers.loadFixture(launchAndClaimProject);
      await rotateGuardian(registry, treasury, outsider);

      await expect(escrow.connect(treasury).emergencyShutdown()).to.be.revertedWith(
        "Only Guardian can trigger emergency shutdown",
      );
      await expect(escrow.connect(outsider).emergencyShutdown()).to.emit(
        escrow,
        "EmergencyShutdownTriggered",
      );
    });

    it("does not let the treasury shut down once the guardian is a different address", async function () {
      const { registry, escrow, treasury, carol } =
        await networkHelpers.loadFixture(launchAndClaimProject);
      await rotateGuardian(registry, treasury, carol);
      expect(await registry.treasury()).to.equal(treasury.address);

      await expect(escrow.connect(treasury).emergencyShutdown()).to.be.revertedWith(
        "Only Guardian can trigger emergency shutdown",
      );
    });
  });

  describe("proposeNewDeveloper", function () {
    it("is allowed for the developer and the guardian but not a stranger", async function () {
      const { escrow, developer, treasury, alice, bob } =
        await networkHelpers.loadFixture(launchProject);

      await escrow.connect(developer).proposeNewDeveloper(bob.address);
      expect(await escrow.pendingDeveloper()).to.equal(bob.address);
      await escrow.connect(treasury).proposeNewDeveloper(alice.address);
      expect(await escrow.pendingDeveloper()).to.equal(alice.address);
      await expect(
        escrow.connect(bob).proposeNewDeveloper(bob.address),
      ).to.be.revertedWith("Only active dev or Guardian can propose");
    });

    it("follows the guardian role: the new guardian can, the old one cannot", async function () {
      const { registry, escrow, treasury, bob, outsider } =
        await networkHelpers.loadFixture(launchProject);
      await rotateGuardian(registry, treasury, outsider);

      await expect(
        escrow.connect(treasury).proposeNewDeveloper(bob.address),
      ).to.be.revertedWith("Only active dev or Guardian can propose");
      await escrow.connect(outsider).proposeNewDeveloper(bob.address);
      expect(await escrow.pendingDeveloper()).to.equal(bob.address);
    });
  });
});
