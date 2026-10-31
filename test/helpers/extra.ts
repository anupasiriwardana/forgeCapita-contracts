import {
  FUNDING_DURATION_DAYS,
  FUNDING_GOAL,
  TOTAL_SUPPLY,
  approveCurrentMilestone,
  deployProtocol,
  ethers,
  launchProject,
  networkHelpers,
  sendEth,
} from "./protocol.js";

export type Project = Awaited<ReturnType<typeof launchProject>>;
export type Signer = Project["alice"];

export const eth = ethers.parseEther;
export const REFUND_WINDOW_SECONDS = 90 * 24 * 60 * 60;

/** Developer cancels, then the 90-day refund window passes, so the guardian may shut the project down. */
export async function cancelAndWaitRefundWindow(project: Project): Promise<void> {
  await project.escrow.connect(project.developer).cancelProject("stop");
  await networkHelpers.time.increase(REFUND_WINDOW_SECONDS);
}

export const CLAIM = 0;
export const STAKE = 1;
export const VOTE = 2;
export const EXECUTE = 3;

const VOTE_TYPES = {
  Vote: [
    { name: "voter", type: "address" },
    { name: "milestoneIndex", type: "uint256" },
    { name: "support", type: "bool" },
    { name: "deadline", type: "uint256" },
  ],
};

const PERMIT_TYPES = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

export async function futureDeadline(seconds = 3600n): Promise<bigint> {
  return BigInt(await networkHelpers.time.latest()) + seconds;
}

export async function signVote(
  project: Project,
  signer: Signer,
  support: boolean,
  deadline: bigint,
  milestoneIndex: bigint,
): Promise<string> {
  const network = await ethers.provider.getNetwork();
  return signer.signTypedData(
    {
      name: "ForgeCapita MilestoneEscrow",
      version: "1",
      chainId: network.chainId,
      verifyingContract: await project.escrow.getAddress(),
    },
    VOTE_TYPES,
    { voter: signer.address, milestoneIndex, support, deadline },
  );
}

export interface PermitOverrides {
  chainId?: bigint;
  verifyingContract?: string;
}

export async function signPermit(
  project: Project,
  signer: Signer,
  spender: string,
  value: bigint,
  deadline: bigint,
  overrides: PermitOverrides = {},
) {
  const network = await ethers.provider.getNetwork();
  const signature = await signer.signTypedData(
    {
      name: "Forge Project",
      version: "1",
      chainId: overrides.chainId ?? network.chainId,
      verifyingContract: overrides.verifyingContract ?? (await project.token.getAddress()),
    },
    PERMIT_TYPES,
    {
      owner: signer.address,
      spender,
      value,
      nonce: await project.token.nonces(signer.address),
      deadline,
    },
  );
  return ethers.Signature.from(signature);
}

/** Launches a project with custom milestone percentages; nothing is funded yet. */
export async function launchWithMilestones(percentages: bigint[]): Promise<Project> {
  const protocol = await deployProtocol();
  const { factory, developer } = protocol;
  const descriptions = percentages.map((_, index) => `Milestone ${index}`);
  const tx = await factory
    .connect(developer)
    .launchProject(
      "Forge Project",
      "FRG",
      TOTAL_SUPPLY,
      descriptions,
      percentages,
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

/** Launches, funds exactly the goal (alice 4, bob 3, carol 3) and closes funding with custom milestones. */
export async function launchClosedWithMilestones(percentages: bigint[]): Promise<Project> {
  const project = await launchWithMilestones(percentages);
  const { developer } = project;
  const escrowAddress = await project.escrow.getAddress();
  await sendEth(project.alice, escrowAddress, eth("4"));
  await sendEth(project.bob, escrowAddress, eth("3"));
  await sendEth(project.carol, escrowAddress, eth("3"));
  await project.escrow.connect(developer).closeFundingAndStart();
  return project;
}

/**
 * Allow-lists `outsider` as relayer. Every action gets a 1 ETH surcharge, so with a per-action cap
 * below 1 ETH each relayer-sponsored action costs exactly the cap.
 */
export async function enableRelayer(project: Project): Promise<void> {
  const registry = project.registry.connect(project.treasury);
  await registry.setRelayer(project.outsider.address, true);
  for (const action of [CLAIM, STAKE, VOTE, EXECUTE]) {
    await registry.setL1Surcharge(action, eth("1"));
  }
}

export async function setCap(project: Project, value: bigint): Promise<void> {
  await project.registry.connect(project.treasury).setMaxCostPerAction(value);
}

/** Claims for anyone who has not yet claimed, stakes everything and opens voting on milestone 0. */
export async function claimStakeAndStart(project: Project): Promise<void> {
  const distributorAddress = await project.distributor.getAddress();
  for (const backer of [project.alice, project.bob, project.carol]) {
    if (!(await project.escrow.hasClaimedTokens(backer.address))) {
      await project.escrow.connect(backer).claimTokens();
    }
    const balance = await project.token.balanceOf(backer.address);
    await project.token.connect(backer).approve(distributorAddress, balance);
    await project.distributor.connect(backer).stake(balance);
  }
  await project.escrow.connect(project.developer).startMilestone(0);
}

/** Alice and Bob vote yes on the open milestone, then `executor` executes it. */
export async function approveAndExecute(project: Project, executor: Signer = project.deployer) {
  await approveCurrentMilestone(project);
  return project.escrow.connect(executor).executeMilestone();
}
