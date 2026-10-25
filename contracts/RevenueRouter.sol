// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "./interfaces/IDividendDistributor.sol";
import "./interfaces/IMilestoneEscrow.sol";

contract RevenueRouter is Initializable, ReentrancyGuard {
    address public milestoneEscrow;
    address payable public dividendDistributor;
    address payable public forgeCapitaTreasury;

    uint256 public creatorPendingFunds;
    uint256 public treasuryPendingFunds;

    event PaymentReceived(address indexed customer, uint256 amountPaid, uint256 creatorCut, uint256 investorCut, uint256 platformFee);
    event FundsClaimed(address indexed claimant, uint256 amount);

    function initialize(
        address _milestoneEscrow,
        address payable _dividendDistributor,
        address payable _treasury
    ) public initializer {
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

        if (IDividendDistributor(dividendDistributor).totalStaked() > 0) {
            creatorPendingFunds += creatorCut;
            (bool successDistributor, ) = dividendDistributor.call{value: investorCut}("");
            require(successDistributor, "Transfer to distributor failed!");
        } else {
            creatorPendingFunds += (creatorCut + investorCut);
        }
        
        emit PaymentReceived(msg.sender, paymentAmount, creatorCut, investorCut, platformFee);
    }

    function claimCreatorFunds() external nonReentrant {
        uint256 amount = creatorPendingFunds;
        require(amount > 0, "No funds to claim");
        address payable currentDeveloper = IMilestoneEscrow(milestoneEscrow).developer();
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
