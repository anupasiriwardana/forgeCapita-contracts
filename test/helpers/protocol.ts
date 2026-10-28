import { network } from "hardhat";

export const { ethers, networkHelpers } = await network.create();

export const DAY = 24 * 60 * 60;
export const TOTAL_SUPPLY = 1000n;
export const ONE_TOKEN = 10n ** 18n;
export const PUBLIC_SUPPLY = 800n * ONE_TOKEN;
export const DEVELOPER_SUPPLY = 200n * ONE_TOKEN;
export const FUNDING_GOAL = ethers.parseEther("10");
export const MILESTONE_PERCENTAGES = [40n, 60n];
export const MILESTONE_DESCRIPTIONS = ["Prototype", "Launch"];
export const FUNDING_DURATION_DAYS = 30n;

export async function deployProtocol() {
  const [deployer, treasury, developer, alice, bob, carol, outsider] =
    await ethers.getSigners();

  const registry = await ethers.deployContract("ForgeCapitaRegistry", [treasury.address]);
  const masterToken = await ethers.deployContract("ProjectToken");
  const masterEscrow = await ethers.deployContract("MilestoneEscrow");
  const masterDistributor = await ethers.deployContract("DividendDistributor");
  const masterRouter = await ethers.deployContract("RevenueRouter");

  const factory = await ethers.deployContract("ForgeCapitaFactory", [
    await masterToken.getAddress(),
    await masterEscrow.getAddress(),
    await masterDistributor.getAddress(),
    await masterRouter.getAddress(),
    await registry.getAddress(),
  ]);
  const p2p = await ethers.getContractAt("P2PExchange", await factory.p2pExchange());

  return { deployer, treasury, developer, alice, bob, carol, outsider, registry, factory, p2p };
}

export async function launchProject() {
  const protocol = await deployProtocol();
  const { factory, developer } = protocol;

  const tx = await factory
    .connect(developer)
    .launchProject(
      "Forge Project",
      "FRG",
      TOTAL_SUPPLY,
      MILESTONE_DESCRIPTIONS,
      MILESTONE_PERCENTAGES,
      FUNDING_GOAL,
      FUNDING_DURATION_DAYS,
    );
  const receipt = await tx.wait();
  if (receipt === null) throw new Error("launchProject receipt missing");

  const [launched] = await factory.queryFilter(
    factory.filters.ProjectLaunched(),
    receipt.blockNumber,
    receipt.blockNumber,
  );
  const { projectToken, milestoneEscrow, dividendDistributor, revenueRouter } = launched.args;

  return {
    ...protocol,
    launchTx: tx,
    token: await ethers.getContractAt("ProjectToken", projectToken),
    escrow: await ethers.getContractAt("MilestoneEscrow", milestoneEscrow),
    distributor: await ethers.getContractAt("DividendDistributor", dividendDistributor),
    router: await ethers.getContractAt("RevenueRouter", revenueRouter),
  };
}

type LaunchedProject = Awaited<ReturnType<typeof launchProject>>;
type Signer = LaunchedProject["alice"];

export async function sendEth(from: Signer, to: string, value: bigint) {
  const tx = await from.sendTransaction({ to, value });
  await tx.wait();
  return tx;
}

/** Ether balance change of `address` caused by `action`, excluding gas if `address` sent the transaction. */
export async function etherDelta(
  address: string,
  action: () => Promise<{ wait(): Promise<{ from: string; fee: bigint } | null> }>,
) {
  const before = await ethers.provider.getBalance(address);
  const tx = await action();
  const receipt = await tx.wait();
  if (receipt === null) throw new Error("transaction receipt missing");
  const after = await ethers.provider.getBalance(address);
  const gasPaid = receipt.from === address ? receipt.fee : 0n;
  return after - before + gasPaid;
}

/** Alice 4 ETH, Bob 3 ETH, Carol 3 ETH: exactly the 10 ETH goal. */
export async function launchAndFundProject() {
  const project = await launchProject();
  const escrowAddress = await project.escrow.getAddress();
  await sendEth(project.alice, escrowAddress, ethers.parseEther("4"));
  await sendEth(project.bob, escrowAddress, ethers.parseEther("3"));
  await sendEth(project.carol, escrowAddress, ethers.parseEther("3"));
  return project;
}

export async function launchAndCloseProject() {
  const project = await launchAndFundProject();
  await project.escrow.connect(project.developer).closeFundingAndStart();
  return project;
}

/** Backers hold their claimed tokens (alice 320, bob 240, carol 240) and nothing is staked yet. */
export async function launchAndClaimProject() {
  const project = await launchAndCloseProject();
  for (const backer of [project.alice, project.bob, project.carol]) {
    await project.escrow.connect(backer).claimTokens();
  }
  return project;
}

/** Everyone staked all their tokens and milestone 0 voting is open. */
export async function launchAndStartMilestoneProject() {
  const project = await launchAndClaimProject();
  const distributorAddress = await project.distributor.getAddress();
  for (const backer of [project.alice, project.bob, project.carol]) {
    const balance = await project.token.balanceOf(backer.address);
    await project.token.connect(backer).approve(distributorAddress, balance);
    await project.distributor.connect(backer).stake(balance);
  }
  await project.escrow.connect(project.developer).startMilestone(0);
  return project;
}

/** Alice and Bob vote yes (560 of 800 public tokens): enough for the fast-track approval. */
export async function approveCurrentMilestone(project: LaunchedProject) {
  await project.escrow.connect(project.alice).vote(true);
  await project.escrow.connect(project.bob).vote(true);
}

/** Approves the current milestone and executes it as `executor` (anyone may execute). */
export async function approveAndExecuteMilestone(
  project: LaunchedProject,
  executor: Signer = project.deployer,
) {
  await approveCurrentMilestone(project);
  return project.escrow.connect(executor).executeMilestone();
}

/** Both milestones executed; backers have unstaked and hold their tokens again. */
export async function launchAndCompleteProject() {
  const project = await launchAndStartMilestoneProject();
  await approveAndExecuteMilestone(project);
  await project.escrow.connect(project.developer).startMilestone(1);
  await approveAndExecuteMilestone(project);
  for (const backer of [project.alice, project.bob, project.carol]) {
    const staked = await project.distributor.stakedBalance(backer.address);
    await project.distributor.connect(backer).withdraw(staked);
  }
  return project;
}
