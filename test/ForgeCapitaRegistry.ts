import { expect } from "chai";
import { ethers, networkHelpers } from "./helpers/protocol.js";

async function deployRegistry() {
  const [admin, other, newTreasury, newGuardian, relayer, outsider] = await ethers.getSigners();
  const registry = await ethers.deployContract("ForgeCapitaRegistry", [admin.address]);
  return { registry, admin, other, newTreasury, newGuardian, relayer, outsider };
}

describe("ForgeCapitaRegistry", function () {
  describe("constructor", function () {
    it("sets treasury and guardian to the admin", async function () {
      const { registry, admin } = await networkHelpers.loadFixture(deployRegistry);

      expect(await registry.treasury()).to.equal(admin.address);
      expect(await registry.guardian()).to.equal(admin.address);
      expect(await registry.maxCostPerAction()).to.equal(0n);
    });

    it("rejects the zero address", async function () {
      const factory = await ethers.getContractFactory("ForgeCapitaRegistry");

      await expect(factory.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        factory,
        "ZeroAddress",
      );
    });
  });

  describe("treasury rotation", function () {
    it("lets only the treasury propose", async function () {
      const { registry, outsider, newTreasury } = await networkHelpers.loadFixture(deployRegistry);

      await expect(
        registry.connect(outsider).proposeTreasury(newTreasury.address),
      ).to.be.revertedWithCustomError(registry, "NotTreasury");
    });

    it("rejects the zero address", async function () {
      const { registry } = await networkHelpers.loadFixture(deployRegistry);

      await expect(registry.proposeTreasury(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        registry,
        "ZeroAddress",
      );
    });

    it("emits proposal and acceptance events and switches the treasury", async function () {
      const { registry, admin, newTreasury } = await networkHelpers.loadFixture(deployRegistry);

      await expect(registry.proposeTreasury(newTreasury.address))
        .to.emit(registry, "TreasuryProposed")
        .withArgs(admin.address, newTreasury.address);
      expect(await registry.pendingTreasury()).to.equal(newTreasury.address);
      expect(await registry.treasury()).to.equal(admin.address);

      await expect(registry.connect(newTreasury).acceptTreasury())
        .to.emit(registry, "TreasuryChanged")
        .withArgs(admin.address, newTreasury.address);
      expect(await registry.treasury()).to.equal(newTreasury.address);
      expect(await registry.pendingTreasury()).to.equal(ethers.ZeroAddress);
    });

    it("reverts when anyone but the pending address accepts", async function () {
      const { registry, admin, outsider, newTreasury } =
        await networkHelpers.loadFixture(deployRegistry);
      await registry.proposeTreasury(newTreasury.address);

      await expect(registry.connect(outsider).acceptTreasury()).to.be.revertedWithCustomError(
        registry,
        "NotPendingTreasury",
      );
      await expect(registry.connect(admin).acceptTreasury()).to.be.revertedWithCustomError(
        registry,
        "NotPendingTreasury",
      );
    });

    it("reverts accept when nothing is pending", async function () {
      const { registry, outsider } = await networkHelpers.loadFixture(deployRegistry);

      await expect(registry.connect(outsider).acceptTreasury()).to.be.revertedWithCustomError(
        registry,
        "NotPendingTreasury",
      );
    });

    it("overwrites an earlier proposal", async function () {
      const { registry, other, newTreasury } = await networkHelpers.loadFixture(deployRegistry);
      await registry.proposeTreasury(other.address);
      await registry.proposeTreasury(newTreasury.address);

      await expect(registry.connect(other).acceptTreasury()).to.be.revertedWithCustomError(
        registry,
        "NotPendingTreasury",
      );
      await registry.connect(newTreasury).acceptTreasury();
      expect(await registry.treasury()).to.equal(newTreasury.address);
    });

    it("removes proposal rights from the old treasury after acceptance", async function () {
      const { registry, admin, newTreasury, other } =
        await networkHelpers.loadFixture(deployRegistry);
      await registry.proposeTreasury(newTreasury.address);
      await registry.connect(newTreasury).acceptTreasury();

      await expect(
        registry.connect(admin).proposeTreasury(other.address),
      ).to.be.revertedWithCustomError(registry, "NotTreasury");
      await expect(registry.connect(newTreasury).proposeTreasury(other.address)).to.emit(
        registry,
        "TreasuryProposed",
      );
    });

    it("does not let a separate guardian propose a treasury", async function () {
      const { registry, admin, newGuardian, other } =
        await networkHelpers.loadFixture(deployRegistry);
      await registry.proposeGuardian(newGuardian.address);
      await registry.connect(newGuardian).acceptGuardian();

      await expect(
        registry.connect(newGuardian).proposeTreasury(other.address),
      ).to.be.revertedWithCustomError(registry, "NotTreasury");
      expect(await registry.treasury()).to.equal(admin.address);
    });
  });

  describe("guardian rotation", function () {
    it("lets only the guardian propose", async function () {
      const { registry, outsider, newGuardian } = await networkHelpers.loadFixture(deployRegistry);

      await expect(
        registry.connect(outsider).proposeGuardian(newGuardian.address),
      ).to.be.revertedWithCustomError(registry, "NotGuardian");
    });

    it("rejects the zero address", async function () {
      const { registry } = await networkHelpers.loadFixture(deployRegistry);

      await expect(registry.proposeGuardian(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        registry,
        "ZeroAddress",
      );
    });

    it("emits proposal and acceptance events and switches the guardian", async function () {
      const { registry, admin, newGuardian } = await networkHelpers.loadFixture(deployRegistry);

      await expect(registry.proposeGuardian(newGuardian.address))
        .to.emit(registry, "GuardianProposed")
        .withArgs(admin.address, newGuardian.address);
      expect(await registry.pendingGuardian()).to.equal(newGuardian.address);

      await expect(registry.connect(newGuardian).acceptGuardian())
        .to.emit(registry, "GuardianChanged")
        .withArgs(admin.address, newGuardian.address);
      expect(await registry.guardian()).to.equal(newGuardian.address);
      expect(await registry.pendingGuardian()).to.equal(ethers.ZeroAddress);
      expect(await registry.treasury()).to.equal(admin.address);
    });

    it("reverts when anyone but the pending address accepts", async function () {
      const { registry, outsider, newGuardian } = await networkHelpers.loadFixture(deployRegistry);
      await registry.proposeGuardian(newGuardian.address);

      await expect(registry.connect(outsider).acceptGuardian()).to.be.revertedWithCustomError(
        registry,
        "NotPendingGuardian",
      );
    });

    it("overwrites an earlier proposal", async function () {
      const { registry, other, newGuardian } = await networkHelpers.loadFixture(deployRegistry);
      await registry.proposeGuardian(other.address);
      await registry.proposeGuardian(newGuardian.address);

      await expect(registry.connect(other).acceptGuardian()).to.be.revertedWithCustomError(
        registry,
        "NotPendingGuardian",
      );
      await registry.connect(newGuardian).acceptGuardian();
      expect(await registry.guardian()).to.equal(newGuardian.address);
    });

    it("removes guardian rights from the old guardian after acceptance", async function () {
      const { registry, admin, newGuardian, relayer } =
        await networkHelpers.loadFixture(deployRegistry);
      await registry.proposeGuardian(newGuardian.address);
      await registry.connect(newGuardian).acceptGuardian();

      await expect(
        registry.connect(admin).setRelayer(relayer.address, true),
      ).to.be.revertedWithCustomError(registry, "NotGuardian");
      await expect(registry.connect(admin).setMaxCostPerAction(1n)).to.be.revertedWithCustomError(
        registry,
        "NotGuardian",
      );
      await expect(registry.connect(admin).setL1Surcharge(0, 1n)).to.be.revertedWithCustomError(
        registry,
        "NotGuardian",
      );
      await expect(
        registry.connect(admin).proposeGuardian(admin.address),
      ).to.be.revertedWithCustomError(registry, "NotGuardian");
      await expect(registry.connect(newGuardian).setRelayer(relayer.address, true)).to.emit(
        registry,
        "RelayerSet",
      );
    });
  });

  describe("relayer allow-list", function () {
    it("adds and removes relayers with events", async function () {
      const { registry, relayer } = await networkHelpers.loadFixture(deployRegistry);
      expect(await registry.isRelayer(relayer.address)).to.equal(false);

      await expect(registry.setRelayer(relayer.address, true))
        .to.emit(registry, "RelayerSet")
        .withArgs(relayer.address, true);
      expect(await registry.isRelayer(relayer.address)).to.equal(true);

      await expect(registry.setRelayer(relayer.address, false))
        .to.emit(registry, "RelayerSet")
        .withArgs(relayer.address, false);
      expect(await registry.isRelayer(relayer.address)).to.equal(false);
    });

    it("reverts for non-guardians", async function () {
      const { registry, outsider, relayer } = await networkHelpers.loadFixture(deployRegistry);

      await expect(
        registry.connect(outsider).setRelayer(relayer.address, true),
      ).to.be.revertedWithCustomError(registry, "NotGuardian");
    });

    it("rejects the zero address", async function () {
      const { registry } = await networkHelpers.loadFixture(deployRegistry);

      await expect(registry.setRelayer(ethers.ZeroAddress, true)).to.be.revertedWithCustomError(
        registry,
        "ZeroAddress",
      );
    });
  });

  describe("maxCostPerAction", function () {
    it("is set by the guardian with an event", async function () {
      const { registry } = await networkHelpers.loadFixture(deployRegistry);

      await expect(registry.setMaxCostPerAction(123n))
        .to.emit(registry, "MaxCostPerActionSet")
        .withArgs(123n);
      expect(await registry.maxCostPerAction()).to.equal(123n);
    });

    it("accepts the limit and rejects anything above", async function () {
      const { registry } = await networkHelpers.loadFixture(deployRegistry);
      const limit = await registry.MAX_COST_PER_ACTION_LIMIT();
      expect(limit).to.equal(ethers.parseEther("1"));

      await registry.setMaxCostPerAction(limit);
      expect(await registry.maxCostPerAction()).to.equal(limit);
      await expect(registry.setMaxCostPerAction(limit + 1n)).to.be.revertedWithCustomError(
        registry,
        "ValueAboveLimit",
      );
    });

    it("reverts for non-guardians", async function () {
      const { registry, outsider } = await networkHelpers.loadFixture(deployRegistry);

      await expect(
        registry.connect(outsider).setMaxCostPerAction(1n),
      ).to.be.revertedWithCustomError(registry, "NotGuardian");
    });
  });

  describe("l1Surcharge", function () {
    it("is set per action with an event", async function () {
      const { registry } = await networkHelpers.loadFixture(deployRegistry);

      await expect(registry.setL1Surcharge(2, 77n))
        .to.emit(registry, "L1SurchargeSet")
        .withArgs(2, 77n);
      expect(await registry.l1Surcharge(2)).to.equal(77n);
      expect(await registry.l1Surcharge(0)).to.equal(0n);
    });

    it("accepts the limit and rejects anything above", async function () {
      const { registry } = await networkHelpers.loadFixture(deployRegistry);
      const limit = await registry.MAX_L1_SURCHARGE_LIMIT();
      expect(limit).to.equal(ethers.parseEther("1"));

      await registry.setL1Surcharge(3, limit);
      expect(await registry.l1Surcharge(3)).to.equal(limit);
      await expect(registry.setL1Surcharge(3, limit + 1n)).to.be.revertedWithCustomError(
        registry,
        "ValueAboveLimit",
      );
    });

    it("rejects an invalid action index when setting and reading", async function () {
      const { registry } = await networkHelpers.loadFixture(deployRegistry);

      await expect(registry.setL1Surcharge(4, 1n)).to.be.revertedWithCustomError(
        registry,
        "InvalidAction",
      );
      await expect(registry.l1Surcharge(4)).to.be.revertedWithCustomError(
        registry,
        "InvalidAction",
      );
    });

    it("reverts for non-guardians", async function () {
      const { registry, outsider } = await networkHelpers.loadFixture(deployRegistry);

      await expect(
        registry.connect(outsider).setL1Surcharge(0, 1n),
      ).to.be.revertedWithCustomError(registry, "NotGuardian");
    });
  });
});
