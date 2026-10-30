import { expect } from "chai";
import {
  ONE_TOKEN,
  launchAndClaimProject,
  networkHelpers,
} from "./helpers/protocol.js";
import { STAKE, futureDeadline, signPermit } from "./helpers/extra.js";

const { time } = networkHelpers;
const AMOUNT = 100n * ONE_TOKEN;

/** CON-02.30: stakeWithPermit continues after a failed permit only for the owner or an allow-listed relayer. */
describe("stakeWithPermit: failed permit handling", function () {
  async function standingAllowance() {
    const project = await launchAndClaimProject();
    const spender = await project.distributor.getAddress();
    await project.token.connect(project.alice).approve(spender, AMOUNT);
    return project;
  }

  async function relayerWithAllowance() {
    const project = await standingAllowance();
    await project.registry.connect(project.treasury).setRelayer(project.outsider.address, true);
    await project.registry.connect(project.treasury).setMaxCostPerAction(10n ** 16n);
    await project.registry.connect(project.treasury).setL1Surcharge(STAKE, 10n ** 15n);
    return project;
  }

  it("reverts 'Permit failed' for a stranger with a junk signature and a standing allowance", async function () {
    const project = await networkHelpers.loadFixture(standingAllowance);
    const { token, distributor, alice, bob, outsider } = project;
    const spender = await distributor.getAddress();
    const deadline = await futureDeadline();
    const junk = await signPermit(project, bob, spender, AMOUNT, deadline);

    await expect(
      distributor
        .connect(outsider)
        .stakeWithPermit(alice.address, AMOUNT, deadline, junk.v, junk.r, junk.s),
    ).to.be.revertedWith("Permit failed");

    expect(await distributor.stakedBalance(alice.address)).to.equal(0n);
    expect(await distributor.totalStaked()).to.equal(0n);
    expect(await token.allowance(alice.address, spender)).to.equal(AMOUNT);
  });

  it("lets the owner continue on a failed permit by using the allowance", async function () {
    const project = await networkHelpers.loadFixture(standingAllowance);
    const { distributor, alice, bob } = project;
    const deadline = await futureDeadline();
    const junk = await signPermit(project, bob, await distributor.getAddress(), AMOUNT, deadline);

    await distributor
      .connect(alice)
      .stakeWithPermit(alice.address, AMOUNT, deadline, junk.v, junk.r, junk.s);

    expect(await distributor.stakedBalance(alice.address)).to.equal(AMOUNT);
  });

  it("lets an allow-listed relayer continue after a front-run permit, and still books the gas", async function () {
    const project = await networkHelpers.loadFixture(launchAndClaimProject);
    const { token, registry, treasury, escrow, distributor, alice, outsider } = project;
    await registry.connect(treasury).setRelayer(outsider.address, true);
    await registry.connect(treasury).setL1Surcharge(STAKE, 10n ** 15n);
    await registry.connect(treasury).setMaxCostPerAction(10n ** 16n);
    const spender = await distributor.getAddress();
    const deadline = await futureDeadline();
    const sig = await signPermit(project, alice, spender, AMOUNT, deadline);
    await token.connect(treasury).permit(alice.address, spender, AMOUNT, deadline, sig.v, sig.r, sig.s);
    const spentBefore = await escrow.gasSpent();

    const tx = await distributor
      .connect(outsider)
      .stakeWithPermit(alice.address, AMOUNT, deadline, sig.v, sig.r, sig.s);

    await expect(tx).to.emit(escrow, "SponsoredGas");
    expect(await escrow.gasSpent()).to.be.greaterThan(spentBefore);
    expect(await distributor.stakedBalance(alice.address)).to.equal(AMOUNT);
  });

  it("lets anyone submit a valid permit", async function () {
    const project = await networkHelpers.loadFixture(launchAndClaimProject);
    const { distributor, alice, outsider } = project;
    const deadline = await futureDeadline();
    const sig = await signPermit(project, alice, await distributor.getAddress(), AMOUNT, deadline);

    await distributor
      .connect(outsider)
      .stakeWithPermit(alice.address, AMOUNT, deadline, sig.v, sig.r, sig.s);

    expect(await distributor.stakedBalance(alice.address)).to.equal(AMOUNT);
  });

  it("reverts 'Permit failed' for a stranger with a wrong-signer, expired or replayed permit even with an allowance", async function () {
    const project = await networkHelpers.loadFixture(standingAllowance);
    const { distributor, alice, bob, outsider } = project;
    const spender = await distributor.getAddress();

    const deadline = await futureDeadline();
    const wrongSigner = await signPermit(project, bob, spender, AMOUNT, deadline);
    await expect(
      distributor
        .connect(outsider)
        .stakeWithPermit(alice.address, AMOUNT, deadline, wrongSigner.v, wrongSigner.r, wrongSigner.s),
    ).to.be.revertedWith("Permit failed");

    const shortDeadline = await futureDeadline(100n);
    const expired = await signPermit(project, alice, spender, AMOUNT, shortDeadline);
    await time.increase(200);
    await expect(
      distributor
        .connect(outsider)
        .stakeWithPermit(alice.address, AMOUNT, shortDeadline, expired.v, expired.r, expired.s),
    ).to.be.revertedWith("Permit failed");

    const freshDeadline = await futureDeadline();
    const valid = await signPermit(project, alice, spender, 10n * ONE_TOKEN, freshDeadline);
    await distributor
      .connect(outsider)
      .stakeWithPermit(alice.address, 10n * ONE_TOKEN, freshDeadline, valid.v, valid.r, valid.s);
    await expect(
      distributor
        .connect(outsider)
        .stakeWithPermit(alice.address, 10n * ONE_TOKEN, freshDeadline, valid.v, valid.r, valid.s),
    ).to.be.revertedWith("Permit failed");
    expect(await distributor.stakedBalance(alice.address)).to.equal(10n * ONE_TOKEN);
  });

  it("stops treating a removed relayer as a relayer", async function () {
    const project = await networkHelpers.loadFixture(relayerWithAllowance);
    const { registry, treasury, distributor, alice, bob, outsider } = project;
    const deadline = await futureDeadline();
    const junk = await signPermit(project, bob, await distributor.getAddress(), AMOUNT, deadline);
    await registry.connect(treasury).setRelayer(outsider.address, false);

    await expect(
      distributor
        .connect(outsider)
        .stakeWithPermit(alice.address, AMOUNT, deadline, junk.v, junk.r, junk.s),
    ).to.be.revertedWith("Permit failed");
  });
});
