import { network } from "hardhat";

async function main() {
    const { ethers } = await network.create();
    const [treasury, dev1, dev2, investor, customer] = await ethers.getSigners();

    console.log("\n==========================================================");
    console.log(" SCENARIO 13: REVENUE ROUTING AFTER DEVELOPER HANDOVER");
    console.log("==========================================================\n");

    // 1. Deploy Master Contracts & Factory
    console.log("Deploying infrastructure...");
    const Token = await ethers.getContractFactory("ProjectToken");
    const masterToken = await Token.deploy();

    const Escrow = await ethers.getContractFactory("MilestoneEscrow");
    const masterEscrow = await Escrow.deploy();

    const Distributor = await ethers.getContractFactory("DividendDistributor");
    const masterDistributor = await Distributor.deploy();

    const Router = await ethers.getContractFactory("RevenueRouter");
    const masterRouter = await Router.deploy();

    const Factory = await ethers.getContractFactory("ForgeCapitaFactory");
    const factory = await Factory.deploy(
        await masterToken.getAddress(),
        await masterEscrow.getAddress(),
        await masterDistributor.getAddress(),
        await masterRouter.getAddress(),
        treasury.address
    );

    // 2. Launch Project via Factory
    console.log("Launching project...");
    const launchTx = await factory.connect(dev1).launchProject(
        "Hostile Takeover Test",
        "HTT",
        1000000,
        ["Milestone 1"],
        [100],
        ethers.parseEther("10"),
        30
    );
    const receipt = await launchTx.wait();

    // Extract clones from events
    const event = receipt?.logs.find(
        (l) => l instanceof ethers.EventLog && l.eventName === "ProjectLaunched"
    ) as ethers.EventLog;
    const [, tokenAddress, escrowAddress, distributorAddress, routerAddress] = event.args;

    const escrow = await ethers.getContractAt("MilestoneEscrow", escrowAddress);
    const router = await ethers.getContractAt("RevenueRouter", routerAddress);
    const distributor = await ethers.getContractAt("DividendDistributor", distributorAddress);
    const token = await ethers.getContractAt("ProjectToken", tokenAddress);

    // 3. Fund Project & Close Funding
    console.log("Funding project and closing campaign...");
    await treasury.sendTransaction({ to: escrowAddress, value: ethers.parseEther("10") });
    await escrow.connect(dev1).closeFundingAndStart();

    // 4. Investor Claims and Stakes Tokens (Required to activate revenue routing)
    await escrow.connect(treasury).claimTokens();
    const investorBalance = await token.balanceOf(treasury.address);
    await token.connect(treasury).approve(distributorAddress, investorBalance);
    await distributor.connect(treasury).stake(investorBalance);

    // 5. First Customer Payment (Under Dev 1)
    console.log("\nCustomer buys subscription for 10 ETH (Dev 1 Active)...");
    await router.connect(customer).routePayment({ value: ethers.parseEther("10") });

    let creatorPending = await router.creatorPendingFunds();
    console.log(`Creator Pending Funds: ${ethers.formatEther(creatorPending)} ETH`);

    console.log("Dev 1 claims funds...");
    const dev1BalBefore = await ethers.provider.getBalance(dev1.address);
    await router.connect(dev1).claimCreatorFunds();
    const dev1BalAfter = await ethers.provider.getBalance(dev1.address);
    console.log(`Dev 1 Net Gain: ${ethers.formatEther(dev1BalAfter - dev1BalBefore)} ETH`);

    // 6. Developer Handover (Hostile Takeover or Sale)
    console.log("\nInitiating Developer Handover (Dev 1 -> Dev 2)...");
    await escrow.connect(dev1).proposeNewDeveloper(dev2.address);
    await escrow.connect(dev2).acceptDeveloperRole();
    console.log(`Active Developer in Escrow is now: ${await escrow.developer()}`);

    // 7. Second Customer Payment (Under Dev 2)
    console.log("\nCustomer buys another subscription for 10 ETH (Dev 2 Active)...");
    await router.connect(customer).routePayment({ value: ethers.parseEther("10") });

    // 8. Security Verification: Dev 1 attempts to steal funds
    console.log("Dev 1 attempts to claim the new revenue...");
    try {
        await router.connect(dev1).claimCreatorFunds();
        console.log("❌ FAILURE: Dev 1 successfully claimed funds!");
    } catch (error: any) {
        console.log("✅ SUCCESS: Dev 1 transaction reverted (Expected: Only active developer can claim)");
    }

    // 9. Dev 2 Claims Funds
    console.log("Dev 2 claims funds...");
    const dev2BalBefore = await ethers.provider.getBalance(dev2.address);
    await router.connect(dev2).claimCreatorFunds();
    const dev2BalAfter = await ethers.provider.getBalance(dev2.address);
    console.log(`Dev 2 Net Gain: ${ethers.formatEther(dev2BalAfter - dev2BalBefore)} ETH`);

    console.log("\nScenario 13 Completed Successfully!");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});