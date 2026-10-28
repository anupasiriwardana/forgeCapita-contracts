import { expect } from "chai";
import {
  DEVELOPER_SUPPLY,
  FUNDING_GOAL,
  MILESTONE_DESCRIPTIONS,
  MILESTONE_PERCENTAGES,
  PUBLIC_SUPPLY,
  TOTAL_SUPPLY,
  deployProtocol,
  launchProject,
  networkHelpers,
} from "./helpers/protocol.js";

describe("ForgeCapitaFactory", function () {
  describe("launchProject", function () {
    it("emits ProjectLaunched with the developer and the four clone addresses", async function () {
      const { factory, developer, launchTx, token, escrow, distributor, router } =
        await networkHelpers.loadFixture(launchProject);

      await expect(launchTx)
        .to.emit(factory, "ProjectLaunched")
        .withArgs(
          developer.address,
          await token.getAddress(),
          await escrow.getAddress(),
          await distributor.getAddress(),
          await router.getAddress(),
        );
    });

    it("records the project in allProjects and developerProjects", async function () {
      const { factory, developer, token } = await networkHelpers.loadFixture(launchProject);

      expect(await factory.getTotalProjects()).to.equal(1n);
      expect(await factory.allProjects(0)).to.equal(await token.getAddress());
      expect(await factory.developerProjects(developer.address, 0)).to.equal(
        await token.getAddress(),
      );
    });

    it("keeps separate bookkeeping for two projects of the same developer", async function () {
      const { factory, developer } = await networkHelpers.loadFixture(deployProtocol);
      const launch = () =>
        factory
          .connect(developer)
          .launchProject("A", "A", 100n, ["m"], [100n], FUNDING_GOAL, 10n);
      await launch();
      await launch();

      expect(await factory.getTotalProjects()).to.equal(2n);
      expect(await factory.allProjects(0)).to.not.equal(await factory.allProjects(1));
      expect(await factory.developerProjects(developer.address, 1)).to.equal(
        await factory.allProjects(1),
      );
    });

    it("transfers token ownership to the escrow", async function () {
      const { token, escrow } = await networkHelpers.loadFixture(launchProject);

      expect(await token.owner()).to.equal(await escrow.getAddress());
    });

    it("moves the whole token supply into the escrow", async function () {
      const { token, escrow } = await networkHelpers.loadFixture(launchProject);

      expect(await token.totalSupply()).to.equal(TOTAL_SUPPLY * 10n ** 18n);
      expect(await token.balanceOf(await escrow.getAddress())).to.equal(
        TOTAL_SUPPLY * 10n ** 18n,
      );
    });

    it("initialises the escrow with developer, treasury, supplies and milestones", async function () {
      const { escrow, token, distributor, developer, treasury } =
        await networkHelpers.loadFixture(launchProject);

      expect(await escrow.developer()).to.equal(developer.address);
      expect(await escrow.forgeCapitaTreasury()).to.equal(treasury.address);
      expect(await escrow.projectToken()).to.equal(await token.getAddress());
      expect(await escrow.dividendDistributor()).to.equal(await distributor.getAddress());
      expect(await escrow.publicSupply()).to.equal(PUBLIC_SUPPLY);
      expect(await escrow.developerSupply()).to.equal(DEVELOPER_SUPPLY);
      expect(await escrow.fundingGoal()).to.equal(FUNDING_GOAL);
      expect(await escrow.isFundingActive()).to.equal(true);

      for (const [index, description] of MILESTONE_DESCRIPTIONS.entries()) {
        const milestone = await escrow.milestones(index);
        expect(milestone.description).to.equal(description);
        expect(milestone.unlockPercentage).to.equal(MILESTONE_PERCENTAGES[index]);
      }
    });

    it("wires the distributor to the token, the factory and the escrow", async function () {
      const { factory, token, escrow, distributor } =
        await networkHelpers.loadFixture(launchProject);

      expect(await distributor.projectToken()).to.equal(await token.getAddress());
      expect(await distributor.factory()).to.equal(await factory.getAddress());
      expect(await distributor.milestoneEscrow()).to.equal(await escrow.getAddress());
    });

    it("wires the router to the escrow, distributor and treasury", async function () {
      const { escrow, distributor, router, treasury } =
        await networkHelpers.loadFixture(launchProject);

      expect(await router.milestoneEscrow()).to.equal(await escrow.getAddress());
      expect(await router.dividendDistributor()).to.equal(await distributor.getAddress());
      expect(await router.forgeCapitaTreasury()).to.equal(treasury.address);
    });

    it("reverts when milestone percentages do not add up to 100", async function () {
      const { factory, developer } = await networkHelpers.loadFixture(deployProtocol);

      await expect(
        factory
          .connect(developer)
          .launchProject("A", "A", 100n, ["a", "b"], [50n, 40n], FUNDING_GOAL, 10n),
      ).to.be.revertedWith("Milestone percentages must equal exactly 100");
    });

    it("reverts with more than five milestones", async function () {
      const { factory, developer } = await networkHelpers.loadFixture(deployProtocol);
      const descriptions = ["1", "2", "3", "4", "5", "6"];
      const percentages = [20n, 20n, 20n, 20n, 10n, 10n];

      await expect(
        factory
          .connect(developer)
          .launchProject("A", "A", 100n, descriptions, percentages, FUNDING_GOAL, 10n),
      ).to.be.revertedWith("Maximum of 5 milestones allowed");
    });
  });

  describe("P2P exchange", function () {
    it("creates one exchange bound to the treasury at construction", async function () {
      const { factory, p2p, treasury } = await networkHelpers.loadFixture(deployProtocol);

      expect(await p2p.getAddress()).to.equal(await factory.p2pExchange());
      expect(await p2p.treasury()).to.equal(treasury.address);
    });
  });

  describe("treasury", function () {
    it("exposes the treasury it was built with", async function () {
      const { factory, treasury } = await networkHelpers.loadFixture(deployProtocol);

      expect(await factory.forgeCapitaTreasury()).to.equal(treasury.address);
    });
  });
});
