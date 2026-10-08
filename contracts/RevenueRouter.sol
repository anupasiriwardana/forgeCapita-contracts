// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IDividendDistributor {
    function totalStaked() external view returns (uint256);
}

interface IMilestoneEscrow {
    function developer() external view returns (address payable);
}

contract RevenueRouter is ReentrancyGuard {
    address public immutable milestoneEscrow;
    address payable public immutable dividendDistributor;
    address payable public immutable forgeCapitaTreasury;
    
    uint256 public creatorPendingFunds;
    uint256 public treasuryPendingFunds;
    
    event PaymentReceived(address indexed customer, uint256 amountPaid, uint256 creatorCut, uint256 investorCut, uint256 platformFee);
    event FundsClaimed(address indexed claimant, uint256 amount);

    constructor(address _milestoneEscrow, address payable _dividendDistributor, address payable _treasury) {
        milestoneEscrow = _milestoneEscrow;
        dividendDistributor = _dividendDistributor;
        forgeCapitaTreasury = _treasury;
    }

    function routePayment() public payable {
        require(msg.value > 0, "You must send ETH to pay.");
        uint256 paymentAmount = msg.value;
        
        uint256 platformFee = (paymentAmount * 1) / 100;
        uint256 creatorCut = (paymentAmount * 24) / 100;
        uint256 investorCut = paymentAmount - creatorCut - platformFee;

        treasuryPendingFunds += platformFee;

        // Check if any investors are staked to receive dividends
        if (IDividendDistributor(dividendDistributor).totalStaked() > 0) {
            creatorPendingFunds += creatorCut;
            
            (bool successDistributor, ) = dividendDistributor.call{value: investorCut}("");
            require(successDistributor, "Transfer to distributor failed!");
        } else {
            // If 0 investors are staked, unallocated yield defaults to developer OpEx
            creatorPendingFunds += (creatorCut + investorCut);
        }

        emit PaymentReceived(msg.sender, paymentAmount, creatorCut, investorCut, platformFee);
    }
    
    function claimCreatorFunds() external nonReentrant {
        uint256 amount = creatorPendingFunds;
        require(amount > 0, "No funds to claim");
        
        //  Dynamically fetch the current developer from the Escrow
        address payable currentDeveloper = IMilestoneEscrow(milestoneEscrow).developer();

        // Ensure only the active developer can trigger this pull
        require(msg.sender == currentDeveloper, "Only active developer can claim");

        creatorPendingFunds = 0;
        (bool success, ) = currentDeveloper.call{value: amount}("");
        require(success, "ETH transfer failed");
        emit FundsClaimed(currentDeveloper, amount);
    }
    
    function claimTreasuryFunds() external nonReentrant {
        uint256 amount = treasuryPendingFunds;
        require(amount > 0, "No funds to claim");
        
        treasuryPendingFunds = 0;
        (bool success, ) = forgeCapitaTreasury.call{value: amount}("");
        require(success, "ETH transfer failed");
        emit FundsClaimed(forgeCapitaTreasury, amount);
    }
}