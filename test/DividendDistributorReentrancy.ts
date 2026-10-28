import { expect } from "chai";
import {
  ONE_TOKEN,
  ethers,
  launchAndClaimProject,
  networkHelpers,
} from "./helpers/protocol.js";

const eth = ethers.parseEther;

const ACTION = { ClaimYield: 1n, Withdraw: 2n, Stake: 3n } as const;

async function launchWithReentrantStaker() {
  const project = await launchAndClaimProject();
  const { token, distributor, router, alice, outsider } = project;
  const staker = await ethers.deployContract("MockReentrantStaker", [
    await distributor.getAddress(),
    await token.getAddress(),
  ]);
  await token.connect(alice).transfer(await staker.getAddress(), 100n * ONE_TOKEN);
  await staker.stakeAll();
  await router.connect(outsider).routePayment({ value: eth("10") });
  return { ...project, staker };
}

describe("DividendDistributor reentrancy guard", function () {
  for (const [name, action] of Object.entries(ACTION)) {
    it(`blocks a ${name} re-entry from the receive() of a claiming staker`, async function () {
      const { distributor, staker } = await networkHelpers.loadFixture(launchWithReentrantStaker);
      const guardSelector = distributor.interface.getError("ReentrancyGuardReentrantCall")?.selector;
      await staker.setAction(action);

      await staker.claim();

      expect(await staker.reentered()).to.equal(true);
      expect(await staker.reentrySucceeded()).to.equal(false);
      expect(await staker.reentryRevertData()).to.equal(guardSelector);
    });
  }

  it("pays the yield exactly once when a re-entry is attempted", async function () {
    const { distributor, staker } = await networkHelpers.loadFixture(launchWithReentrantStaker);
    await staker.setAction(ACTION.ClaimYield);
    const stakerAddress = await staker.getAddress();
    const expected = await distributor.getClaimableYield(stakerAddress);
    expect(expected).to.be.greaterThan(0n);

    const before = await ethers.provider.getBalance(stakerAddress);
    await expect(staker.claim()).to.emit(distributor, "YieldClaimed").withArgs(stakerAddress, expected);

    expect(await ethers.provider.getBalance(stakerAddress)).to.equal(before + expected);
    expect(await distributor.rewards(stakerAddress)).to.equal(0n);
    expect(await distributor.getClaimableYield(stakerAddress)).to.equal(0n);
  });

  it("still lets the same staker withdraw and claim normally afterwards", async function () {
    const { distributor, token, staker } = await networkHelpers.loadFixture(
      launchWithReentrantStaker,
    );
    const stakerAddress = await staker.getAddress();

    await staker.claim();
    await staker.withdrawAmount(40n * ONE_TOKEN);

    expect(await distributor.stakedBalance(stakerAddress)).to.equal(60n * ONE_TOKEN);
    expect(await token.balanceOf(stakerAddress)).to.equal(40n * ONE_TOKEN);
  });

  it("keeps accepting routed payments (receive() is not guarded)", async function () {
    const { distributor, router, outsider, staker } = await networkHelpers.loadFixture(
      launchWithReentrantStaker,
    );
    const before = await distributor.dividendPerToken();

    await router.connect(outsider).routePayment({ value: eth("1") });

    expect(await distributor.dividendPerToken()).to.be.greaterThan(before);
    expect(await distributor.getClaimableYield(await staker.getAddress())).to.be.greaterThan(0n);
  });
});
