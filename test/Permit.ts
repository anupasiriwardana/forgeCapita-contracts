import { expect } from "chai";
import {
  ONE_TOKEN,
  ethers,
  launchAndClaimProject,
  networkHelpers,
} from "./helpers/protocol.js";

const PERMIT_TYPES = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

type Project = Awaited<ReturnType<typeof launchAndClaimProject>>;
type Signer = Project["alice"];

async function signPermit(
  project: Project,
  signer: Signer,
  spender: string,
  value: bigint,
  deadline: bigint,
  nonce?: bigint,
) {
  const { token } = project;
  const network = await ethers.provider.getNetwork();
  const domain = {
    name: "Forge Project",
    version: "1",
    chainId: network.chainId,
    verifyingContract: await token.getAddress(),
  };
  const message = {
    owner: signer.address,
    spender,
    value,
    nonce: nonce ?? (await token.nonces(signer.address)),
    deadline,
  };
  return ethers.Signature.from(await signer.signTypedData(domain, PERMIT_TYPES, message));
}

async function futureDeadline(): Promise<bigint> {
  return BigInt(await networkHelpers.time.latest()) + 3600n;
}

describe("ProjectToken permit", function () {
  it("sets the allowance and increments the nonce", async function () {
    const project = await networkHelpers.loadFixture(launchAndClaimProject);
    const { token, alice, outsider } = project;
    const deadline = await futureDeadline();
    const sig = await signPermit(project, alice, outsider.address, 50n * ONE_TOKEN, deadline);

    await token
      .connect(outsider)
      .permit(alice.address, outsider.address, 50n * ONE_TOKEN, deadline, sig.v, sig.r, sig.s);

    expect(await token.allowance(alice.address, outsider.address)).to.equal(50n * ONE_TOKEN);
    expect(await token.nonces(alice.address)).to.equal(1n);
  });

  it("reverts for an expired deadline", async function () {
    const project = await networkHelpers.loadFixture(launchAndClaimProject);
    const { token, alice, outsider } = project;
    const deadline = BigInt(await networkHelpers.time.latest()) + 100n;
    const sig = await signPermit(project, alice, outsider.address, 1n, deadline);
    await networkHelpers.time.increase(200);

    await expect(
      token.permit(alice.address, outsider.address, 1n, deadline, sig.v, sig.r, sig.s),
    ).to.be.revertedWithCustomError(token, "ERC2612ExpiredSignature");
  });

  it("reverts for the wrong signer or a stale nonce", async function () {
    const project = await networkHelpers.loadFixture(launchAndClaimProject);
    const { token, alice, bob, outsider } = project;
    const deadline = await futureDeadline();

    const bobSig = await signPermit(project, bob, outsider.address, 1n, deadline);
    await expect(
      token.permit(alice.address, outsider.address, 1n, deadline, bobSig.v, bobSig.r, bobSig.s),
    ).to.be.revertedWithCustomError(token, "ERC2612InvalidSigner");

    const wrongNonce = await signPermit(project, alice, outsider.address, 1n, deadline, 5n);
    await expect(
      token.permit(
        alice.address,
        outsider.address,
        1n,
        deadline,
        wrongNonce.v,
        wrongNonce.r,
        wrongNonce.s,
      ),
    ).to.be.revertedWithCustomError(token, "ERC2612InvalidSigner");
  });

  it("reverts after emergency invalidation", async function () {
    const project = await networkHelpers.loadFixture(launchAndClaimProject);
    const { token, escrow, treasury, alice, outsider } = project;
    const deadline = await futureDeadline();
    const sig = await signPermit(project, alice, outsider.address, 1n, deadline);
    await escrow.connect(treasury).emergencyShutdown();

    await expect(
      token.permit(alice.address, outsider.address, 1n, deadline, sig.v, sig.r, sig.s),
    ).to.be.revertedWith("Token is dead (Emergency Shutdown)");
  });
});

describe("DividendDistributor stakeWithPermit", function () {
  it("lets a third party stake for the owner with no prior approve", async function () {
    const project = await networkHelpers.loadFixture(launchAndClaimProject);
    const { token, distributor, alice, outsider } = project;
    const spender = await distributor.getAddress();
    const amount = 100n * ONE_TOKEN;
    const deadline = await futureDeadline();
    const sig = await signPermit(project, alice, spender, amount, deadline);

    await expect(
      distributor
        .connect(outsider)
        .stakeWithPermit(alice.address, amount, deadline, sig.v, sig.r, sig.s),
    )
      .to.emit(distributor, "Staked")
      .withArgs(alice.address, amount);

    expect(await distributor.stakedBalance(alice.address)).to.equal(amount);
    expect(await distributor.stakedBalance(outsider.address)).to.equal(0n);
    expect(await token.balanceOf(alice.address)).to.equal(220n * ONE_TOKEN);
    expect(await token.allowance(alice.address, spender)).to.equal(0n);
    expect(await token.nonces(alice.address)).to.equal(1n);
  });

  it("still stakes when the permit was front-run and the allowance suffices", async function () {
    const project = await networkHelpers.loadFixture(launchAndClaimProject);
    const { token, distributor, alice, outsider } = project;
    const spender = await distributor.getAddress();
    const amount = 100n * ONE_TOKEN;
    const deadline = await futureDeadline();
    const sig = await signPermit(project, alice, spender, amount, deadline);
    await token
      .connect(outsider)
      .permit(alice.address, spender, amount, deadline, sig.v, sig.r, sig.s);

    await distributor
      .connect(outsider)
      .stakeWithPermit(alice.address, amount, deadline, sig.v, sig.r, sig.s);

    expect(await distributor.stakedBalance(alice.address)).to.equal(amount);
  });

  it("fails cleanly when the permit is invalid and there is no allowance", async function () {
    const project = await networkHelpers.loadFixture(launchAndClaimProject);
    const { token, distributor, alice, bob, outsider } = project;
    const spender = await distributor.getAddress();
    const amount = 100n * ONE_TOKEN;
    const deadline = await futureDeadline();
    const bobSig = await signPermit(project, bob, spender, amount, deadline);

    await expect(
      distributor
        .connect(outsider)
        .stakeWithPermit(alice.address, amount, deadline, bobSig.v, bobSig.r, bobSig.s),
    ).to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
    expect(await distributor.stakedBalance(alice.address)).to.equal(0n);
  });

  it("fails cleanly when the owner's balance is insufficient", async function () {
    const project = await networkHelpers.loadFixture(launchAndClaimProject);
    const { token, distributor, alice, outsider } = project;
    const spender = await distributor.getAddress();
    const amount = 321n * ONE_TOKEN;
    const deadline = await futureDeadline();
    const sig = await signPermit(project, alice, spender, amount, deadline);

    await expect(
      distributor
        .connect(outsider)
        .stakeWithPermit(alice.address, amount, deadline, sig.v, sig.r, sig.s),
    ).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
    expect(await distributor.totalStaked()).to.equal(0n);
  });

  it("fails after emergency invalidation", async function () {
    const project = await networkHelpers.loadFixture(launchAndClaimProject);
    const { escrow, treasury, distributor, alice, outsider } = project;
    const amount = 10n * ONE_TOKEN;
    const deadline = await futureDeadline();
    const sig = await signPermit(project, alice, await distributor.getAddress(), amount, deadline);
    await escrow.connect(treasury).emergencyShutdown();

    await expect(
      distributor
        .connect(outsider)
        .stakeWithPermit(alice.address, amount, deadline, sig.v, sig.r, sig.s),
    ).to.be.revertedWith("Token is dead (Emergency Shutdown)");
  });

  it("mixes with approve + stake for the same owner", async function () {
    const project = await networkHelpers.loadFixture(launchAndClaimProject);
    const { token, distributor, alice, outsider } = project;
    const spender = await distributor.getAddress();
    const deadline = await futureDeadline();
    const sig = await signPermit(project, alice, spender, 100n * ONE_TOKEN, deadline);
    await distributor
      .connect(outsider)
      .stakeWithPermit(alice.address, 100n * ONE_TOKEN, deadline, sig.v, sig.r, sig.s);

    await token.connect(alice).approve(spender, 50n * ONE_TOKEN);
    await distributor.connect(alice).stake(50n * ONE_TOKEN);

    expect(await distributor.stakedBalance(alice.address)).to.equal(150n * ONE_TOKEN);
    expect(await distributor.totalStaked()).to.equal(150n * ONE_TOKEN);
  });
});
