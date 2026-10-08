// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract RevenueRouter is ReentrancyGuard {
    address payable public immutable creatorAddress;
    address payable public immutable dividendDistributor;
    address payable public immutable forgeCapitaTreasury;
    
    // Internal ledgers for the "Pull" method
    uint256 public creatorPendingFunds;
    uint256 public treasuryPendingFunds;
    
    event PaymentReceived(
        address indexed customer, 
        uint256 amountPaid, 
        uint256 creatorCut, 
        uint256 investorCut, 
        uint256 platformFee
    );
    
    event FundsClaimed(address indexed claimant, uint256 amount);

    constructor(
        address payable _creatorAddress, 
        address payable _dividendDistributor,
        address payable _treasury
    ) {
        creatorAddress = _creatorAddress;
        dividendDistributor = _dividendDistributor;
        forgeCapitaTreasury = _treasury;
    }

    function routePayment() public payable {
        require(msg.value > 0, "You must send ETH to pay.");
        uint256 paymentAmount = msg.value;
        
        // 1. Calculate the 1% platform fee
        uint256 platformFee = (paymentAmount * 1) / 100;
        
        // 2. Calculate the 39% developer cut
        uint256 creatorCut = (paymentAmount * 39) / 100;
        
        // 3. The remainder (60%) goes to investors
        uint256 investorCut = paymentAmount - creatorCut - platformFee;

        // PULL METHOD: Update internal ledgers for external/untrusted addresses
        creatorPendingFunds += creatorCut;
        treasuryPendingFunds += platformFee;

        // PUSH METHOD: Send instantly to the trusted DividendDistributor
        // (This triggers the passive yield for investors without risking a DoS)
        (bool successDistributor, ) = dividendDistributor.call{value: investorCut}("");
        require(successDistributor, "Transfer to distributor failed!");

        emit PaymentReceived(msg.sender, paymentAmount, creatorCut, investorCut, platformFee);
    }
    
    /**
     * @dev Allows the developer to pull their accumulated SaaS revenue.
     */
    function claimCreatorFunds() external nonReentrant {
        uint256 amount = creatorPendingFunds;
        require(amount > 0, "No funds to claim");
        
        // Reset ledger before transfer to prevent reentrancy attacks
        creatorPendingFunds = 0;
        
        (bool success, ) = creatorAddress.call{value: amount}("");
        require(success, "ETH transfer failed");
        
        emit FundsClaimed(creatorAddress, amount);
    }
    
    /**
     * @dev Allows the forgeCapita platform to pull its accumulated fees.
     */
    function claimTreasuryFunds() external nonReentrant {
        uint256 amount = treasuryPendingFunds;
        require(amount > 0, "No funds to claim");
        
        treasuryPendingFunds = 0;
        
        (bool success, ) = forgeCapitaTreasury.call{value: amount}("");
        require(success, "ETH transfer failed");
        
        emit FundsClaimed(forgeCapitaTreasury, amount);
    }
}