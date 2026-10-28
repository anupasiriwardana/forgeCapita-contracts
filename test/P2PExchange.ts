import { expect } from "chai";
import {
  ONE_TOKEN,
  ethers,
  etherDelta,
  launchAndClaimProject,
  networkHelpers,
} from "./helpers/protocol.js";

const eth = ethers.parseEther;
const LISTED_AMOUNT = 100n * ONE_TOKEN;
const PRICE = eth("1");

async function listingFixture() {
  const project = await launchAndClaimProject();
  const { token, p2p, alice } = project;
  await token.connect(alice).approve(await p2p.getAddress(), LISTED_AMOUNT);
  const tx = await p2p
    .connect(alice)
    .createListing(await token.getAddress(), LISTED_AMOUNT, PRICE);
  return { ...project, createTx: tx };
}

describe("P2PExchange", function () {
  describe("createListing", function () {
    it("escrows the tokens and stores the listing", async function () {
      const { token, p2p, alice } = await networkHelpers.loadFixture(listingFixture);

      const listing = await p2p.listings(0);
      expect(listing.seller).to.equal(alice.address);
      expect(listing.tokenAddress).to.equal(await token.getAddress());
      expect(listing.tokenAmount).to.equal(LISTED_AMOUNT);
      expect(listing.priceInETH).to.equal(PRICE);
      expect(listing.active).to.equal(true);
      expect(await token.balanceOf(await p2p.getAddress())).to.equal(LISTED_AMOUNT);
      expect(await token.balanceOf(alice.address)).to.equal(220n * ONE_TOKEN);
      expect(await p2p.nextListingId()).to.equal(1n);
    });

    it("emits ListingCreated", async function () {
      const { token, p2p, alice, createTx } = await networkHelpers.loadFixture(listingFixture);

      await expect(createTx)
        .to.emit(p2p, "ListingCreated")
        .withArgs(0n, alice.address, await token.getAddress(), LISTED_AMOUNT, PRICE);
    });

    it("reverts for a zero amount", async function () {
      const { token, p2p, alice } = await networkHelpers.loadFixture(launchAndClaimProject);

      await expect(
        p2p.connect(alice).createListing(await token.getAddress(), 0n, PRICE),
      ).to.be.revertedWith("Amount must be > 0");
    });

    it("reverts for a zero price", async function () {
      const { token, p2p, alice } = await networkHelpers.loadFixture(launchAndClaimProject);

      await expect(
        p2p.connect(alice).createListing(await token.getAddress(), LISTED_AMOUNT, 0n),
      ).to.be.revertedWith("Price must be > 0");
    });

    it("reverts without token allowance", async function () {
      const { token, p2p, alice } = await networkHelpers.loadFixture(launchAndClaimProject);

      await expect(
        p2p.connect(alice).createListing(await token.getAddress(), LISTED_AMOUNT, PRICE),
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
    });
  });

  describe("fillListing", function () {
    it("gives the buyer the tokens", async function () {
      const { token, p2p, bob } = await networkHelpers.loadFixture(listingFixture);

      await p2p.connect(bob).fillListing(0, { value: PRICE });

      expect(await token.balanceOf(bob.address)).to.equal(240n * ONE_TOKEN + LISTED_AMOUNT);
      expect((await p2p.listings(0)).active).to.equal(false);
    });

    it("pays the seller 99% of the price", async function () {
      const { p2p, alice, bob } = await networkHelpers.loadFixture(listingFixture);

      const delta = await etherDelta(alice.address, () =>
        p2p.connect(bob).fillListing(0, { value: PRICE }),
      );

      expect(delta).to.equal(eth("0.99"));
    });

    it("sends the 1% fee to the treasury", async function () {
      const { p2p, treasury, bob } = await networkHelpers.loadFixture(listingFixture);

      const delta = await etherDelta(treasury.address, () =>
        p2p.connect(bob).fillListing(0, { value: PRICE }),
      );

      expect(delta).to.equal(eth("0.01"));
    });

    it("emits ListingFilled", async function () {
      const { p2p, alice, bob } = await networkHelpers.loadFixture(listingFixture);

      await expect(p2p.connect(bob).fillListing(0, { value: PRICE }))
        .to.emit(p2p, "ListingFilled")
        .withArgs(0n, bob.address, alice.address, PRICE);
    });

    it("reverts when the ETH sent differs from the price", async function () {
      const { p2p, bob } = await networkHelpers.loadFixture(listingFixture);

      await expect(p2p.connect(bob).fillListing(0, { value: eth("0.5") })).to.be.revertedWith(
        "Incorrect ETH amount sent",
      );
    });

    it("reverts when the listing was already filled", async function () {
      const { p2p, bob, carol } = await networkHelpers.loadFixture(listingFixture);
      await p2p.connect(bob).fillListing(0, { value: PRICE });

      await expect(p2p.connect(carol).fillListing(0, { value: PRICE })).to.be.revertedWith(
        "Listing is not active",
      );
    });
  });

  describe("cancelListing", function () {
    it("returns the tokens to the seller and emits ListingCancelled", async function () {
      const { token, p2p, alice } = await networkHelpers.loadFixture(listingFixture);

      await expect(p2p.connect(alice).cancelListing(0))
        .to.emit(p2p, "ListingCancelled")
        .withArgs(0n, alice.address);

      expect(await token.balanceOf(alice.address)).to.equal(320n * ONE_TOKEN);
      expect((await p2p.listings(0)).active).to.equal(false);
    });

    it("reverts for anyone but the seller", async function () {
      const { p2p, bob } = await networkHelpers.loadFixture(listingFixture);

      await expect(p2p.connect(bob).cancelListing(0)).to.be.revertedWith("Only seller can cancel");
    });

    it("reverts when the listing is no longer active", async function () {
      const { p2p, alice } = await networkHelpers.loadFixture(listingFixture);
      await p2p.connect(alice).cancelListing(0);

      await expect(p2p.connect(alice).cancelListing(0)).to.be.revertedWith(
        "Listing is not active",
      );
    });

    it("prevents filling a cancelled listing", async function () {
      const { p2p, alice, bob } = await networkHelpers.loadFixture(listingFixture);
      await p2p.connect(alice).cancelListing(0);

      await expect(p2p.connect(bob).fillListing(0, { value: PRICE })).to.be.revertedWith(
        "Listing is not active",
      );
    });
  });
});
