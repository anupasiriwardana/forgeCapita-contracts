import { expect } from "chai";
import type { ContractTransactionResponse } from "ethers";
import {
  CLAIM,
  EXECUTE,
  STAKE,
  VOTE,
  type Project,
  type Signer,
  enableRelayer,
  eth,
  futureDeadline,
  launchClosedWithMilestones,
  setCap,
  signPermit,
  signVote,
} from "./helpers/extra.js";

/**
 * CON-03.9: measured gas units (receipt.gasUsed, which includes the 21000 intrinsic cost and
 * calldata) for the sponsored actions. Output feeds docs/gas-measurements-v2.md. The upper bounds
 * are loose regression guards, not targets.
 */
const measured = new Map<string, bigint>();
const ledgerEstimate = new Map<string, bigint>();

async function measure(label: string, pending: Promise<ContractTransactionResponse>): Promise<void> {
  const receipt = await (await pending).wait();
  if (receipt === null) throw new Error(`receipt missing for ${label}`);
  measured.set(label, receipt.gasUsed);
}

/** Gas units the contract's own cost model booked, recovered from the SponsoredGas event (zero surcharge). */
async function measureRelayed(
  project: Project,
  label: string,
  pending: Promise<ContractTransactionResponse>,
): Promise<void> {
  const receipt = await (await pending).wait();
  if (receipt === null) throw new Error(`receipt missing for ${label}`);
  measured.set(label, receipt.gasUsed);
  const escrowAddress = await project.escrow.getAddress();
  for (const log of receipt.logs) {
    if (log.address !== escrowAddress) continue;
    const parsed = project.escrow.interface.parseLog({ topics: [...log.topics], data: log.data });
    if (parsed?.name === "SponsoredGas") {
      ledgerEstimate.set(label, (parsed.args.cost as bigint) / receipt.gasPrice);
    }
  }
}

async function permitStake(
  project: Project,
  submitter: Signer,
  owner: Signer,
): Promise<ContractTransactionResponse> {
  const amount = await project.token.balanceOf(owner.address);
  const deadline = await futureDeadline();
  const sig = await signPermit(project, owner, await project.distributor.getAddress(), amount, deadline);
  return project.distributor
    .connect(submitter)
    .stakeWithPermit(owner.address, amount, deadline, sig.v, sig.r, sig.s);
}

async function signedVote(
  project: Project,
  submitter: Signer,
  voter: Signer,
  index: bigint,
): Promise<ContractTransactionResponse> {
  const deadline = await futureDeadline();
  const sig = await signVote(project, voter, true, deadline, index);
  return project.escrow.connect(submitter).voteBySig(voter.address, true, deadline, sig);
}

async function stakeDirectly(project: Project, backers: Signer[]): Promise<void> {
  const spender = await project.distributor.getAddress();
  for (const backer of backers) {
    const balance = await project.token.balanceOf(backer.address);
    await project.token.connect(backer).approve(spender, balance);
    await project.distributor.connect(backer).stake(balance);
  }
}

async function relayerProject(surcharge: bigint, cap: bigint): Promise<Project> {
  const project = await launchClosedWithMilestones([40n, 60n]);
  await enableRelayer(project);
  for (const action of [CLAIM, STAKE, VOTE, EXECUTE]) {
    await project.registry.connect(project.treasury).setL1Surcharge(action, surcharge);
  }
  await setCap(project, cap);
  return project;
}

/** Full lifecycle where relayer actions are priced by gas only (zero surcharge): measures every action. */
async function measureRelayerLifecycle(): Promise<void> {
  const project = await relayerProject(0n, eth("1"));
  const { escrow, alice, bob, carol, developer, outsider, deployer } = project;
  await measureRelayed(project, "claim.relayer.firstInProject", escrow.connect(outsider).claimTokensFor(alice.address));
  await measureRelayed(project, "claim.relayer", escrow.connect(outsider).claimTokensFor(bob.address));
  await measure("claim.selfPay", escrow.connect(carol).claimTokens());

  await measureRelayed(project, "stake.relayer.firstStaker", permitStake(project, outsider, alice));
  await measureRelayed(project, "stake.relayer", permitStake(project, outsider, bob));
  await measure("stake.plainSubmitter", permitStake(project, deployer, carol));

  await escrow.connect(developer).startMilestone(0);
  await measureRelayed(project, "vote.relayer.firstVoter", signedVote(project, outsider, alice, 0n));
  await measureRelayed(project, "vote.relayer", signedVote(project, outsider, bob, 0n));
  await measure("vote.plainSubmitter", signedVote(project, deployer, carol, 0n));

  await measureRelayed(project, "execute.nonFinal.relayer.noDebt", escrow.connect(outsider).executeMilestone());
  await escrow.connect(developer).startMilestone(1);
  await escrow.connect(alice).vote(true);
  await escrow.connect(bob).vote(true);
  await measureRelayed(project, "execute.final.relayer.noDebt", escrow.connect(outsider).executeMilestone());
}

async function measurePlainLifecycle(): Promise<void> {
  const project = await launchClosedWithMilestones([40n, 60n]);
  const { escrow, alice, bob, carol, developer, deployer } = project;
  await measure("claim.plainSubmitter", escrow.connect(deployer).claimTokensFor(alice.address));
  await escrow.connect(bob).claimTokens();
  await escrow.connect(carol).claimTokens();
  const spender = await project.distributor.getAddress();
  for (const backer of [alice, bob, carol]) {
    await project.token.connect(backer).approve(spender, await project.token.balanceOf(backer.address));
  }
  await project.distributor.connect(alice).stake(await project.token.balanceOf(alice.address));
  await measure("stake.direct.secondStaker", project.distributor.connect(bob).stake(await project.token.balanceOf(bob.address)));
  await project.distributor.connect(carol).stake(await project.token.balanceOf(carol.address));
  await escrow.connect(developer).startMilestone(0);
  await measure("vote.direct.firstVoter", escrow.connect(alice).vote(true));
  await measure("vote.direct", escrow.connect(bob).vote(true));
  await measure("execute.nonFinal.plain.noDebt", escrow.connect(deployer).executeMilestone());
  await escrow.connect(developer).startMilestone(1);
  await escrow.connect(alice).vote(true);
  await escrow.connect(bob).vote(true);
  await measure("execute.final.plain.noDebt", escrow.connect(deployer).executeMilestone());
}

/** Debt of 0.7 ETH over budget with the relayer paying 0.6 ETH per action, then both milestones deduct. */
async function measureDebtLifecycle(byRelayer: boolean): Promise<void> {
  const project = await relayerProject(eth("1"), eth("0.6"));
  const { escrow, alice, bob, carol, developer, outsider, deployer } = project;
  await escrow.connect(outsider).claimTokensFor(alice.address);
  await escrow.connect(outsider).claimTokensFor(bob.address);
  await escrow.connect(carol).claimTokens();
  await stakeDirectly(project, [alice, bob, carol]);
  const executor = byRelayer ? outsider : deployer;
  const tag = byRelayer ? "relayer" : "plain";

  await escrow.connect(developer).startMilestone(0);
  await escrow.connect(alice).vote(true);
  await escrow.connect(bob).vote(true);
  await measure(`execute.nonFinal.${tag}.withDeduction`, escrow.connect(executor).executeMilestone());
  await escrow.connect(developer).startMilestone(1);
  await escrow.connect(alice).vote(true);
  await escrow.connect(bob).vote(true);
  await setCap(project, eth("0.1"));
  await measure(`execute.final.${tag}.withDeduction`, escrow.connect(executor).executeMilestone());
}

describe("Gas measurements (CON-03.9)", function () {
  this.timeout(300_000);

  it("measures receipt.gasUsed for every sponsored action", async function () {
    await measureRelayerLifecycle();
    await measurePlainLifecycle();
    await measureDebtLifecycle(true);
    await measureDebtLifecycle(false);

    const lines = [...measured.entries()].map(
      ([label, gas]) =>
        `${label.padEnd(36)} ${gas.toString().padStart(8)}` +
        (ledgerEstimate.has(label) ? `   ledger booked ${ledgerEstimate.get(label)}` : ""),
    );
    console.log(`      GAS UNITS (receipt.gasUsed)\n        ${lines.join("\n        ")}`);

    for (const [label, gas] of measured) {
      expect(gas > 21_000n && gas < 400_000n, `${label} gasUsed ${gas}`).to.equal(true);
    }
    expect(measured.has("execute.final.relayer.withDeduction")).to.equal(true);
    for (const [label, booked] of ledgerEstimate) {
      const actual = measured.get(label);
      expect(actual !== undefined && booked <= actual, `${label} ledger booked ${booked} must not exceed actual ${actual}`).to.equal(true);
      // Steady-state calls must be booked within 5% of actual. First-in-project calls pay one-off cold
      // storage and first-write costs that the fixed overheads deliberately do not include (>= 70%).
      const floorPercent = label.includes("first") ? 70n : 95n;
      expect(
        actual !== undefined && booked * 100n >= actual * floorPercent,
        `${label} ledger booked ${booked} is below ${floorPercent}% of actual ${actual}`,
      ).to.equal(true);
    }
    expect(ledgerEstimate.size).to.equal(8);
  });
});
