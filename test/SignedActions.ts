import { expect } from "chai";
import {
  FUNDING_DURATION_DAYS,
  FUNDING_GOAL,
  MILESTONE_DESCRIPTIONS,
  MILESTONE_PERCENTAGES,
  ONE_TOKEN,
  TOTAL_SUPPLY,
  ethers,
  launchAndClaimProject,
  launchAndCloseProject,
  launchAndStartMilestoneProject,
  launchProject,
  networkHelpers,
} from "./helpers/protocol.js";

const VOTE_TYPES = {
  Vote: [
    { name: "voter", type: "address" },
    { name: "milestoneIndex", type: "uint256" },
    { name: "support", type: "bool" },
    { name: "deadline", type: "uint256" },
  ],
};

const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

type Project = Awaited<ReturnType<typeof launchProject>>;
type Signer = Project["alice"];

interface VoteOverrides {
  milestoneIndex?: bigint;
  chainId?: bigint;
  verifyingContract?: string;
  voter?: string;
}

async function signVote(
  project: Project,
  signer: Signer,
  support: boolean,
  deadline: bigint,
  overrides: VoteOverrides = {},
): Promise<string> {
  const network = await ethers.provider.getNetwork();
  const domain = {
    name: "ForgeCapita MilestoneEscrow",
    version: "1",
    chainId: overrides.chainId ?? network.chainId,
    verifyingContract: overrides.verifyingContract ?? (await project.escrow.getAddress()),
  };
  return signer.signTypedData(domain, VOTE_TYPES, {
    voter: overrides.voter ?? signer.address,
    milestoneIndex: overrides.milestoneIndex ?? 0n,
    support,
    deadline,
  });
}

async function futureDeadline(): Promise<bigint> {
  return BigInt(await networkHelpers.time.latest()) + 3600n;
}

async function launchSecondEscrow(project: Project): Promise<string> {
  const { factory, developer } = project;
  const tx = await factory
    .connect(developer)
    .launchProject(
      "Other Project",
      "OTH",
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
  return launched.args.milestoneEscrow;
}

describe("claimTokensFor", function () {
  it("sends tokens to the depositor, not the caller", async function () {
    const { escrow, token, alice, outsider } =
      await networkHelpers.loadFixture(launchAndCloseProject);

    await escrow.connect(outsider).claimTokensFor(alice.address);

    expect(await token.balanceOf(alice.address)).to.equal(320n * ONE_TOKEN);
    expect(await token.balanceOf(outsider.address)).to.equal(0n);
    expect(await escrow.hasClaimedTokens(alice.address)).to.equal(true);
  });

  it("reverts a second time, including after a self-claim", async function () {
    const { escrow, alice, outsider } = await networkHelpers.loadFixture(launchAndCloseProject);
    await escrow.connect(outsider).claimTokensFor(alice.address);

    await expect(escrow.connect(outsider).claimTokensFor(alice.address)).to.be.revertedWith(
      "Tokens already claimed",
    );
    await expect(escrow.connect(alice).claimTokens()).to.be.revertedWith("Tokens already claimed");
  });

  it("reverts for an account without a deposit", async function () {
    const { escrow, outsider, bob } = await networkHelpers.loadFixture(launchAndCloseProject);

    await expect(escrow.connect(bob).claimTokensFor(outsider.address)).to.be.revertedWith(
      "No investment found",
    );
  });

  it("reverts while funding is still active", async function () {
    const { escrow, alice, outsider } = await networkHelpers.loadFixture(launchProject);

    await expect(escrow.connect(outsider).claimTokensFor(alice.address)).to.be.revertedWith(
      "Funding phase is still active",
    );
  });

  it("keeps the self-pay claimTokens working", async function () {
    const { escrow, token, bob } = await networkHelpers.loadFixture(launchAndCloseProject);

    await escrow.connect(bob).claimTokens();

    expect(await token.balanceOf(bob.address)).to.equal(240n * ONE_TOKEN);
  });
});

describe("voteBySig", function () {
  it("records the vote for the signer when a third party submits it", async function () {
    const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
    const { escrow, alice, outsider } = project;
    const deadline = await futureDeadline();
    const signature = await signVote(project, alice, true, deadline);

    await expect(escrow.connect(outsider).voteBySig(alice.address, true, deadline, signature))
      .to.emit(escrow, "Voted")
      .withArgs(alice.address, 0n, true, 320n * ONE_TOKEN);

    expect(await escrow.hasVoted(0n, alice.address)).to.equal(true);
    expect(await escrow.hasVoted(0n, outsider.address)).to.equal(false);
    expect((await escrow.milestones(0n)).yesVotes).to.equal(320n * ONE_TOKEN);
  });

  it("counts a no vote", async function () {
    const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
    const { escrow, bob, outsider } = project;
    const deadline = await futureDeadline();
    const signature = await signVote(project, bob, false, deadline);

    await escrow.connect(outsider).voteBySig(bob.address, false, deadline, signature);

    expect((await escrow.milestones(0n)).noVotes).to.equal(240n * ONE_TOKEN);
  });

  it("reverts for an expired deadline", async function () {
    const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
    const { escrow, alice, outsider } = project;
    const deadline = BigInt(await networkHelpers.time.latest()) + 100n;
    const signature = await signVote(project, alice, true, deadline);
    await networkHelpers.time.increase(200);

    await expect(
      escrow.connect(outsider).voteBySig(alice.address, true, deadline, signature),
    ).to.be.revertedWith("Vote signature expired");
  });

  it("reverts when signed by someone other than the voter", async function () {
    const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
    const { escrow, alice, bob, outsider } = project;
    const deadline = await futureDeadline();
    const signature = await signVote(project, bob, true, deadline, { voter: alice.address });

    await expect(
      escrow.connect(outsider).voteBySig(alice.address, true, deadline, signature),
    ).to.be.revertedWith("Invalid vote signature");
  });

  it("reverts for a different chain id", async function () {
    const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
    const { escrow, alice, outsider } = project;
    const deadline = await futureDeadline();
    const signature = await signVote(project, alice, true, deadline, { chainId: 1n });

    await expect(
      escrow.connect(outsider).voteBySig(alice.address, true, deadline, signature),
    ).to.be.revertedWith("Invalid vote signature");
  });

  it("reverts for a signature bound to another escrow clone", async function () {
    const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
    const { escrow, alice, outsider } = project;
    const otherEscrow = await launchSecondEscrow(project);
    const deadline = await futureDeadline();
    const signature = await signVote(project, alice, true, deadline, {
      verifyingContract: otherEscrow,
    });

    await expect(
      escrow.connect(outsider).voteBySig(alice.address, true, deadline, signature),
    ).to.be.revertedWith("Invalid vote signature");
  });

  it("reverts when support, milestone index or deadline are tampered with", async function () {
    const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
    const { escrow, alice, outsider } = project;
    const deadline = await futureDeadline();

    const signedYes = await signVote(project, alice, true, deadline);
    await expect(
      escrow.connect(outsider).voteBySig(alice.address, false, deadline, signedYes),
    ).to.be.revertedWith("Invalid vote signature");

    const signedWrongIndex = await signVote(project, alice, true, deadline, { milestoneIndex: 1n });
    await expect(
      escrow.connect(outsider).voteBySig(alice.address, true, deadline, signedWrongIndex),
    ).to.be.revertedWith("Invalid vote signature");

    await expect(
      escrow.connect(outsider).voteBySig(alice.address, true, deadline + 1n, signedYes),
    ).to.be.revertedWith("Invalid vote signature");
  });

  it("rejects a high-s malleable signature", async function () {
    const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
    const { escrow, alice, outsider } = project;
    const deadline = await futureDeadline();
    const signature = ethers.Signature.from(await signVote(project, alice, true, deadline));
    const highS = SECP256K1_N - BigInt(signature.s);
    const flippedV = signature.v === 27 ? 28 : 27;
    const malleable = ethers.concat([
      signature.r,
      ethers.toBeHex(highS, 32),
      ethers.toBeHex(flippedV, 1),
    ]);

    await expect(
      escrow.connect(outsider).voteBySig(alice.address, true, deadline, malleable),
    ).to.be.revertedWith("Invalid vote signature");
    await escrow.connect(outsider).voteBySig(alice.address, true, deadline, signature.serialized);
  });

  it("blocks a second vote on the same milestone in both orders", async function () {
    const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
    const { escrow, alice, bob, outsider } = project;
    const deadline = await futureDeadline();

    const aliceSig = await signVote(project, alice, true, deadline);
    await escrow.connect(outsider).voteBySig(alice.address, true, deadline, aliceSig);
    await expect(
      escrow.connect(outsider).voteBySig(alice.address, true, deadline, aliceSig),
    ).to.be.revertedWith("Already voted");
    await expect(escrow.connect(alice).vote(false)).to.be.revertedWith("Already voted");

    await escrow.connect(bob).vote(true);
    const bobSig = await signVote(project, bob, true, deadline);
    await expect(
      escrow.connect(outsider).voteBySig(bob.address, true, deadline, bobSig),
    ).to.be.revertedWith("Already voted");
  });

  it("bars the developer", async function () {
    const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
    const { escrow, developer, outsider } = project;
    const deadline = await futureDeadline();
    const signature = await signVote(project, developer, true, deadline);

    await expect(
      escrow.connect(outsider).voteBySig(developer.address, true, deadline, signature),
    ).to.be.revertedWith("Developer cannot vote");
  });

  it("reverts for a signer without staked tokens", async function () {
    const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
    const { escrow, outsider, deployer } = project;
    const deadline = await futureDeadline();
    const signature = await signVote(project, outsider, true, deadline);

    await expect(
      escrow.connect(deployer).voteBySig(outsider.address, true, deadline, signature),
    ).to.be.revertedWith("No voting power (must stake tokens first)");
  });

  it("reverts when voting is not open", async function () {
    const project = await networkHelpers.loadFixture(launchAndClaimProject);
    const { escrow, alice, outsider } = project;
    const deadline = await futureDeadline();
    const signature = await signVote(project, alice, true, deadline);

    await expect(
      escrow.connect(outsider).voteBySig(alice.address, true, deadline, signature),
    ).to.be.revertedWith("Voting is not open");
  });

  it("locks the signer's stake, not the submitter's", async function () {
    const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
    const { escrow, distributor, alice, bob } = project;
    const deadline = await futureDeadline();
    const signature = await signVote(project, alice, true, deadline);

    await escrow.connect(bob).voteBySig(alice.address, true, deadline, signature);

    expect(await escrow.isUserVoteLocked(alice.address)).to.equal(true);
    expect(await escrow.isUserVoteLocked(bob.address)).to.equal(false);
    await expect(distributor.connect(alice).withdraw(1n)).to.be.revertedWith(
      "Tokens locked in active milestone vote",
    );
    await distributor.connect(bob).withdraw(1n);
  });

  it("mixes signed and direct votes toward the same tally", async function () {
    const project = await networkHelpers.loadFixture(launchAndStartMilestoneProject);
    const { escrow, alice, bob, carol, outsider } = project;
    const deadline = await futureDeadline();

    await escrow
      .connect(outsider)
      .voteBySig(alice.address, true, deadline, await signVote(project, alice, true, deadline));
    await escrow.connect(bob).vote(true);
    await escrow
      .connect(outsider)
      .voteBySig(carol.address, false, deadline, await signVote(project, carol, false, deadline));

    const milestone = await escrow.milestones(0n);
    expect(milestone.yesVotes).to.equal(560n * ONE_TOKEN);
    expect(milestone.noVotes).to.equal(240n * ONE_TOKEN);
  });

  describe("ERC-1271 smart wallets", function () {
    async function walletFixture() {
      const project = await launchAndClaimProject();
      const { token, distributor, escrow, alice, bob, developer } = project;
      const wallet = await ethers.deployContract("MockERC1271Wallet", [bob.address]);
      const walletAddress = await wallet.getAddress();
      const distributorAddress = await distributor.getAddress();
      const amount = 100n * ONE_TOKEN;
      await token.connect(bob).transfer(walletAddress, amount);
      await wallet
        .connect(bob)
        .execute(
          await token.getAddress(),
          token.interface.encodeFunctionData("approve", [distributorAddress, amount]),
        );
      await wallet
        .connect(bob)
        .execute(distributorAddress, distributor.interface.encodeFunctionData("stake", [amount]));
      await token.connect(alice).approve(distributorAddress, 320n * ONE_TOKEN);
      await distributor.connect(alice).stake(320n * ONE_TOKEN);
      await escrow.connect(developer).startMilestone(0);
      return { ...project, wallet, walletAddress };
    }

    it("accepts a signature validated by the wallet", async function () {
      const project = await networkHelpers.loadFixture(walletFixture);
      const { escrow, bob, outsider, walletAddress } = project;
      const deadline = await futureDeadline();
      const signature = await signVote(project, bob, true, deadline, { voter: walletAddress });

      await expect(escrow.connect(outsider).voteBySig(walletAddress, true, deadline, signature))
        .to.emit(escrow, "Voted")
        .withArgs(walletAddress, 0n, true, 100n * ONE_TOKEN);
    });

    it("rejects a signature the wallet owner did not produce", async function () {
      const project = await networkHelpers.loadFixture(walletFixture);
      const { escrow, alice, outsider, walletAddress } = project;
      const deadline = await futureDeadline();
      const signature = await signVote(project, alice, true, deadline, { voter: walletAddress });

      await expect(
        escrow.connect(outsider).voteBySig(walletAddress, true, deadline, signature),
      ).to.be.revertedWith("Invalid vote signature");
    });

    it("does not let a malicious wallet re-enter during validation", async function () {
      const project = await networkHelpers.loadFixture(walletFixture);
      const { escrow, bob, outsider, wallet, walletAddress } = project;
      await wallet.connect(bob).configureReentry(await escrow.getAddress(), true);
      const deadline = await futureDeadline();
      const signature = await signVote(project, bob, true, deadline, { voter: walletAddress });

      await expect(
        escrow.connect(outsider).voteBySig(walletAddress, true, deadline, signature),
      ).to.be.revertedWith("Invalid vote signature");
      expect(await escrow.hasVoted(0n, walletAddress)).to.equal(false);
      expect((await escrow.milestones(0n)).yesVotes).to.equal(0n);

      await wallet.connect(bob).configureReentry(await escrow.getAddress(), false);
      await escrow.connect(outsider).voteBySig(walletAddress, true, deadline, signature);
      expect((await escrow.milestones(0n)).yesVotes).to.equal(100n * ONE_TOKEN);
    });
  });
});
