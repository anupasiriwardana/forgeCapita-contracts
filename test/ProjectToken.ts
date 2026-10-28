import { expect } from "chai";
import {
  ONE_TOKEN,
  TOTAL_SUPPLY,
  launchAndClaimProject,
  launchProject,
  networkHelpers,
} from "./helpers/protocol.js";

describe("ProjectToken", function () {
  describe("metadata", function () {
    it("has the launch name, symbol and 18 decimals", async function () {
      const { token } = await networkHelpers.loadFixture(launchProject);

      expect(await token.name()).to.equal("Forge Project");
      expect(await token.symbol()).to.equal("FRG");
      expect(await token.decimals()).to.equal(18n);
      expect(await token.totalSupply()).to.equal(TOTAL_SUPPLY * ONE_TOKEN);
    });

    it("cannot be initialised a second time", async function () {
      const { token, outsider } = await networkHelpers.loadFixture(launchProject);

      await expect(
        token.connect(outsider).initialize("X", "X", 1n, outsider.address),
      ).to.be.revertedWithCustomError(token, "InvalidInitialization");
    });
  });

  describe("transfers before invalidation", function () {
    it("transfers tokens between holders", async function () {
      const { token, alice, outsider } = await networkHelpers.loadFixture(launchAndClaimProject);

      await token.connect(alice).transfer(outsider.address, 5n * ONE_TOKEN);

      expect(await token.balanceOf(outsider.address)).to.equal(5n * ONE_TOKEN);
    });

    it("supports approve and transferFrom", async function () {
      const { token, alice, bob, outsider } = await networkHelpers.loadFixture(launchAndClaimProject);
      await token.connect(alice).approve(bob.address, 5n * ONE_TOKEN);

      await token.connect(bob).transferFrom(alice.address, outsider.address, 5n * ONE_TOKEN);

      expect(await token.balanceOf(outsider.address)).to.equal(5n * ONE_TOKEN);
    });
  });

  describe("emergencyInvalidate", function () {
    it("reverts for anyone but the owner", async function () {
      const { token, outsider } = await networkHelpers.loadFixture(launchProject);

      await expect(token.connect(outsider).emergencyInvalidate())
        .to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount")
        .withArgs(outsider.address);
    });

    it("is not callable by the developer", async function () {
      const { token, developer } = await networkHelpers.loadFixture(launchProject);

      await expect(token.connect(developer).emergencyInvalidate()).to.be.revertedWithCustomError(
        token,
        "OwnableUnauthorizedAccount",
      );
    });

    it("blocks transfer, transferFrom and approve once the escrow invalidates the token", async function () {
      const { token, escrow, treasury, alice, bob } =
        await networkHelpers.loadFixture(launchAndClaimProject);

      await expect(escrow.connect(treasury).emergencyShutdown()).to.emit(token, "TokenInvalidated");

      const dead = "Token is dead (Emergency Shutdown)";
      await expect(token.connect(alice).transfer(bob.address, 1n)).to.be.revertedWith(dead);
      await expect(token.connect(alice).approve(bob.address, 1n)).to.be.revertedWith(dead);
      await expect(
        token.connect(bob).transferFrom(alice.address, bob.address, 1n),
      ).to.be.revertedWith(dead);
    });
  });

  describe("burn", function () {
    it("burns the caller's own tokens and reduces total supply", async function () {
      const { token, alice } = await networkHelpers.loadFixture(launchAndClaimProject);

      await token.connect(alice).burn(20n * ONE_TOKEN);

      expect(await token.balanceOf(alice.address)).to.equal(300n * ONE_TOKEN);
      expect(await token.totalSupply()).to.equal(TOTAL_SUPPLY * ONE_TOKEN - 20n * ONE_TOKEN);
    });

    it("reverts when burning more than the balance", async function () {
      const { token, alice } = await networkHelpers.loadFixture(launchAndClaimProject);

      await expect(token.connect(alice).burn(321n * ONE_TOKEN)).to.be.revertedWithCustomError(
        token,
        "ERC20InsufficientBalance",
      );
    });
  });
});
