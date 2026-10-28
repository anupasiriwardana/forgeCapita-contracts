import { expect } from "chai";
import { DAY, DEVELOPER_SUPPLY, ethers, networkHelpers, sendEth } from "./helpers/protocol.js";
import {
  type Project,
  type Signer,
  enableRelayer,
  eth,
  futureDeadline,
  launchWithMilestones,
  setCap,
  signPermit,
  signVote,
} from "./helpers/extra.js";

/**
 * Seeded randomized property tests (CON-03.5). No Solidity fuzz plugin is installed, so these are
 * deterministic TypeScript scenarios: fixed seed, bounded iterations, every amount a bigint.
 * Each scenario builds a random project (milestone split, deposits, relayer spending, staking
 * churn, executors) and re-checks the invariants after every state change.
 */
const SEED = 20261028;
const SCENARIOS = 10;
const BPS = 10_000n;
const MAX_DEBT_BPS = 1500n;

class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** mulberry32: uniform 32-bit unsigned integer. */
  private next32(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  int(min: number, max: number): number {
    return min + (this.next32() % (max - min + 1));
  }

  /** Uniform-ish bigint in [min, max]; modulo bias over 96 bits is negligible here. */
  big(min: bigint, max: bigint): bigint {
    const raw =
      (BigInt(this.next32()) << 64n) | (BigInt(this.next32()) << 32n) | BigInt(this.next32());
    return min + (raw % (max - min + 1n));
  }

  chance(percent: number): boolean {
    return this.int(0, 99) < percent;
  }

  pick<T>(items: T[]): T {
    return items[this.int(0, items.length - 1)];
  }
}

function randomPercentages(rng: Rng): bigint[] {
  const count = rng.int(1, 5);
  const weights = Array.from({ length: count }, () => rng.int(1, 20));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const percentages = weights.map((weight) => BigInt(Math.max(1, Math.floor((weight * 100) / total))));
  const assigned = percentages.reduce((sum, value) => sum + value, 0n);
  percentages[0] += 100n - assigned;
  return percentages;
}

const stats = { ceilingReverts: 0, deductingMilestones: 0, writeOffs: 0 };

function isCeilingRevert(error: unknown): boolean {
  return error instanceof Error && error.message.includes("Gas ceiling exceeded");
}

/** Runs the relayed action; if the exposure ceiling rejects it, runs the self-pay fallback. */
async function relayedOrSelfPaid(
  relayed: () => Promise<unknown>,
  selfPaid: () => Promise<unknown>,
): Promise<void> {
  try {
    await relayed();
  } catch (error) {
    if (!isCeilingRevert(error)) throw error;
    stats.ceilingReverts++;
    await selfPaid();
  }
}

async function balance(address: string): Promise<bigint> {
  return ethers.provider.getBalance(address);
}

async function expectStakeInvariant(project: Project, backers: Signer[]): Promise<void> {
  const { distributor, token } = project;
  let sum = 0n;
  for (const backer of backers) sum += await distributor.stakedBalance(backer.address);
  expect(await distributor.totalStaked()).to.equal(sum);
  expect(await token.balanceOf(await distributor.getAddress())).to.equal(sum);
}

async function expectLedgerInvariant(project: Project): Promise<void> {
  const { escrow } = project;
  const [spent, budget, recovered, net] = await Promise.all([
    escrow.gasSpent(),
    escrow.gasBudget(),
    escrow.gasRecovered(),
    escrow.netFunds(),
  ]);
  const overflow = spent > budget ? spent - budget : 0n;
  expect(recovered <= overflow).to.equal(true);
  expect(spent <= budget + (net * MAX_DEBT_BPS) / BPS).to.equal(true);
}

async function runFailedCrowdfund(project: Project, rng: Rng, backers: Signer[]): Promise<void> {
  const { escrow } = project;
  const escrowAddress = await escrow.getAddress();
  const deposits = backers.map(() => rng.big(eth("0.5"), eth("3.2")));
  for (let i = 0; i < backers.length; i++) await sendEth(backers[i], escrowAddress, deposits[i]);
  let remaining = deposits.reduce((sum, value) => sum + value, 0n);
  expect(await balance(escrowAddress)).to.equal(remaining);

  await networkHelpers.time.increase(31 * DAY);
  for (let i = 0; i < backers.length; i++) {
    await escrow.connect(backers[i]).refundFailedCrowdfund();
    remaining -= deposits[i];
    expect(await balance(escrowAddress)).to.equal(remaining);
  }
  expect(await balance(escrowAddress)).to.equal(0n);
}

async function runFundedProject(project: Project, rng: Rng, backers: Signer[], percentages: bigint[]): Promise<void> {
  const { escrow, token, distributor, registry, treasury, developer, deployer, outsider } = project;
  const escrowAddress = await escrow.getAddress();
  const distributorAddress = await distributor.getAddress();
  const deposits = backers.map(() => rng.big(eth("3.4"), eth("6")) + rng.big(0n, 10n ** 9n));
  for (let i = 0; i < backers.length; i++) await sendEth(backers[i], escrowAddress, deposits[i]);
  const totalDeposits = deposits.reduce((sum, value) => sum + value, 0n);
  expect(await balance(escrowAddress)).to.equal(totalDeposits);

  await enableRelayer(project);
  await escrow.connect(developer).closeFundingAndStart();
  const net = await escrow.netFunds();
  expect(net).to.equal(totalDeposits - (totalDeposits * 5n) / 100n);
  expect(await escrow.gasBudget()).to.equal((totalDeposits * 5n) / 100n);
  expect(await balance(escrowAddress)).to.equal(net);

  const randomCap = async (): Promise<void> => setCap(project, rng.big(0n, eth("0.6")));

  for (const backer of backers) {
    await randomCap();
    await relayedOrSelfPaid(
      () =>
        rng.chance(60)
          ? escrow.connect(outsider).claimTokensFor(backer.address)
          : escrow.connect(backer).claimTokens(),
      () => escrow.connect(backer).claimTokens(),
    );
    await expectLedgerInvariant(project);
  }

  for (let step = 0; step < rng.int(2, 8); step++) {
    const backer = rng.pick(backers);
    const held = await token.balanceOf(backer.address);
    const staked = await distributor.stakedBalance(backer.address);
    if (held > 0n && rng.chance(65)) {
      const amount = rng.big(1n, held);
      if (rng.chance(50)) {
        await token.connect(backer).approve(distributorAddress, amount);
        await distributor.connect(backer).stake(amount);
      } else {
        await randomCap();
        const deadline = await futureDeadline();
        const permit = await signPermit(project, backer, distributorAddress, amount, deadline);
        await relayedOrSelfPaid(
          () =>
            distributor
              .connect(outsider)
              .stakeWithPermit(backer.address, amount, deadline, permit.v, permit.r, permit.s),
          async () => {
            await token.connect(backer).approve(distributorAddress, amount);
            await distributor.connect(backer).stake(amount);
          },
        );
      }
    } else if (staked > 0n) {
      await distributor.connect(backer).withdraw(rng.big(1n, staked));
    }
    await expectStakeInvariant(project, backers);
    await expectLedgerInvariant(project);
  }

  for (const backer of backers) {
    const held = await token.balanceOf(backer.address);
    if (held === 0n) continue;
    await token.connect(backer).approve(distributorAddress, held);
    await distributor.connect(backer).stake(held);
  }
  await expectStakeInvariant(project, backers);

  let released = 0n;
  let deductions = 0n;
  let developerEth = 0n;
  for (let index = 0; index < percentages.length; index++) {
    await escrow.connect(developer).startMilestone(index);
    for (const backer of backers) {
      await randomCap();
      const deadline = await futureDeadline();
      const signature = await signVote(project, backer, true, deadline, BigInt(index));
      await relayedOrSelfPaid(
        () =>
          rng.chance(50)
            ? escrow.connect(outsider).voteBySig(backer.address, true, deadline, signature)
            : escrow.connect(backer).vote(true),
        () => escrow.connect(backer).vote(true),
      );
      await expectLedgerInvariant(project);
    }

    await randomCap();
    const recoveredBefore = await escrow.gasRecovered();
    const developerBefore = await balance(developer.address);
    const treasuryBefore = await balance(treasury.address);
    const executor = rng.chance(50) ? outsider : deployer;
    let execution;
    try {
      execution = await escrow.connect(executor).executeMilestone();
    } catch (error) {
      if (!isCeilingRevert(error)) throw error;
      stats.ceilingReverts++;
      execution = await escrow.connect(deployer).executeMilestone();
    }
    await execution.wait();

    const release = (net * percentages[index]) / 100n;
    const deduction = (await escrow.gasRecovered()) - recoveredBefore;
    const developerDelta = (await balance(developer.address)) - developerBefore;
    const treasuryDelta = (await balance(treasury.address)) - treasuryBefore;
    expect(deduction * BPS <= release * MAX_DEBT_BPS).to.equal(true);
    expect(developerDelta).to.equal(release - deduction);
    expect(treasuryDelta).to.equal(deduction);

    if (deduction > 0n) stats.deductingMilestones++;
    released += release;
    deductions += deduction;
    developerEth += developerDelta;
    expect(await balance(escrowAddress)).to.equal(net - released);
    await expectLedgerInvariant(project);
    await expectStakeInvariant(project, backers);
  }

  expect(deductions * BPS <= net * MAX_DEBT_BPS).to.equal(true);
  expect(developerEth + deductions + (await balance(escrowAddress))).to.equal(net);
  expect(await token.balanceOf(developer.address)).to.equal(DEVELOPER_SUPPLY);
  expect(await escrow.completed()).to.equal(true);

  const spent = await escrow.gasSpent();
  const budget = await escrow.gasBudget();
  const overflow = spent > budget ? spent - budget : 0n;
  const writtenOff = await escrow.queryFilter(escrow.filters.GasDebtWrittenOff());
  const leftover = overflow - (await escrow.gasRecovered());
  if (leftover > 0n) {
    stats.writeOffs++;
    expect(writtenOff.length).to.equal(1);
    expect(writtenOff[0].args.amount).to.equal(leftover);
  } else {
    expect(writtenOff.length).to.equal(0);
  }
}

describe("Randomized invariants (seeded)", function () {
  this.timeout(300_000);

  it(`holds the escrow, ledger and staking invariants over ${SCENARIOS} seeded scenarios (seed ${SEED})`, async function () {
    const started = Date.now();
    const rng = new Rng(SEED);
    let funded = 0;
    let failed = 0;

    for (let scenario = 0; scenario < SCENARIOS; scenario++) {
      const percentages = randomPercentages(rng);
      expect(percentages.reduce((sum, value) => sum + value, 0n)).to.equal(100n);
      const project = await launchWithMilestones(percentages);
      const backers = [project.alice, project.bob, project.carol];
      if (scenario % 4 === 3) {
        await runFailedCrowdfund(project, rng, backers);
        failed++;
      } else {
        await runFundedProject(project, rng, backers, percentages);
        funded++;
      }
    }

    console.log(
      `      invariants: seed=${SEED} scenarios=${SCENARIOS} (funded=${funded}, failed-crowdfund=${failed}) ceilingReverts=${stats.ceilingReverts} deductingMilestones=${stats.deductingMilestones} writeOffs=${stats.writeOffs} runtime=${Date.now() - started} ms`,
    );
  });
});
