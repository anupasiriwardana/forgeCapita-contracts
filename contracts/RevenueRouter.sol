// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract RevenueRouter {
    // 1. State Variables
    address payable public immutable creatorAddress; // The startup's wallet that receives 80% of all incoming payments
    address payable public immutable dividendDistributor; // The Dividend Distributor contract that receives 20% of all incoming payments

    // 2. The Event (Your Node.js Indexer will still listen for this!)
    event PaymentReceived(address indexed customer, uint256 amountPaid, uint256 creatorCut, uint256 investorCut);

    // 3. Constructor (Runs once when deployed by the ForgeCapita Factory)
    constructor(address payable _creatorAddress, address payable _dividendDistributor) {
        creatorAddress = _creatorAddress;
        dividendDistributor = _dividendDistributor;
    }

    // 4. The Core Logic: Intercepting and Splitting the Money
    function routePayment() public payable {
        // Require that the customer actually sent some money
        require(msg.value > 0, "You must send ETH to pay.");

        uint256 paymentAmount = msg.value;

        // Calculate the 80% cut for the creator
        uint256 creatorCut = (paymentAmount * 80) / 100;
        
        // Calculate the 20% cut for the investors
        uint256 investorCut = paymentAmount - creatorCut;

        // Instantly push the 80% to the Creator's wallet
        (bool successCreator, ) = creatorAddress.call{value: creatorCut}("");
        require(successCreator, "Transfer to creator failed!");

        // Instantly push the 20% directly into the Dividend Distributor contract
        // This automatically triggers the `receive() external payable` function inside the Distributor!
        (bool successDistributor, ) = dividendDistributor.call{value: investorCut}("");
        require(successDistributor, "Transfer to distributor failed!");

        // Broadcast the event to the blockchain
        emit PaymentReceived(msg.sender, paymentAmount, creatorCut, investorCut);
    }
}