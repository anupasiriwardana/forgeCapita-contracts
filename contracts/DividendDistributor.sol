// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title DividendDistributor
 * @dev Distributes ETH yield proportionally to investors who stake their ForgeCapita Project Tokens.
 */
contract DividendDistributor is ReentrancyGuard {
    IERC20 public immutable projectToken; // The ERC-20 token representing fractional equity or yield claims for the startup
    
    uint256 public totalStaked; // The total amount of Project Tokens currently staked in the contract
    uint256 public dividendPerToken; // The high-water mark of ETH yield per staked token, scaled by MAGNIFIER to avoid precision loss
    
    // Used to prevent precision loss when dividing small amounts of ETH by large token supplies
    uint256 private constant MAGNIFIER = 1e18;

    mapping(address => uint256) public stakedBalance;
    mapping(address => uint256) public userDividendPerTokenPaid;
    mapping(address => uint256) public rewards;

    event DividendsDeposited(uint256 amount);
    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event YieldClaimed(address indexed user, uint256 amount);

    constructor(address _projectToken) {
        projectToken = IERC20(_projectToken);
    }

    /**
     * @dev The RevenueRouter sends the 20% SaaS yield directly here.
     * The yield is instantly distributed proportionally across all currently staked tokens.
     */
    receive() external payable {
        require(totalStaked > 0, "No tokens staked to receive dividends");
        
        // Increases the global reward rate based on the incoming ETH
        dividendPerToken += (msg.value * MAGNIFIER) / totalStaked;
        
        emit DividendsDeposited(msg.value);
    }

    /**
     * @dev Modifier that calculates and locks in a user's pending yield 
     * before their balance changes (staking/withdrawing/claiming).
     */
    modifier updateDividend(address account) {
        rewards[account] = getClaimableYield(account);
        userDividendPerTokenPaid[account] = dividendPerToken;
        _;
    }

    /**
     * @dev Calculates the exact amount of ETH a user is currently owed.
     */
    function getClaimableYield(address account) public view returns (uint256) {
        return (stakedBalance[account] * (dividendPerToken - userDividendPerTokenPaid[account])) / MAGNIFIER + rewards[account];
    }

    /**
     * @dev Investors deposit their Project Tokens to start earning yield.
     */
    function stake(uint256 amount) external nonReentrant updateDividend(msg.sender) {
        require(amount > 0, "Cannot stake 0");
        
        totalStaked += amount;
        stakedBalance[msg.sender] += amount;
        
        require(projectToken.transferFrom(msg.sender, address(this), amount), "Token transfer failed");
        
        emit Staked(msg.sender, amount);
    }

    /**
     * @dev Investors withdraw their Project Tokens, pausing their yield generation.
     */
    function withdraw(uint256 amount) external nonReentrant updateDividend(msg.sender) {
        require(amount > 0, "Cannot withdraw 0");
        require(stakedBalance[msg.sender] >= amount, "Insufficient staked balance");
        
        totalStaked -= amount;
        stakedBalance[msg.sender] -= amount;
        
        require(projectToken.transfer(msg.sender, amount), "Token transfer failed");
        
        emit Withdrawn(msg.sender, amount);
    }

    /**
     * @dev Investors claim their accumulated ETH yield straight to their wallets.
     */
    function claimYield() external nonReentrant updateDividend(msg.sender) {
        uint256 reward = rewards[msg.sender];
        require(reward > 0, "No yield available");
        
        rewards[msg.sender] = 0;
        
        (bool success, ) = msg.sender.call{value: reward}("");
        require(success, "ETH transfer failed");
        
        emit YieldClaimed(msg.sender, reward);
    }
}