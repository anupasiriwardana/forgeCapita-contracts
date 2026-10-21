// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IMilestoneEscrow.sol";

/**
 * @title DividendDistributor
 * @dev Distributes ETH yield and secures staked-governance voting weight.
 */
contract DividendDistributor is ReentrancyGuard {
    IERC20 public immutable projectToken;
    address public immutable factory;
    address public milestoneEscrow;

    uint256 public totalStaked;
    uint256 public dividendPerToken;

    uint256 private constant MAGNIFIER = 1e18;

    mapping(address => uint256) public stakedBalance;
    mapping(address => uint256) public userDividendPerTokenPaid;
    mapping(address => uint256) public rewards;

    event DividendsDeposited(uint256 amount);
    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event YieldClaimed(address indexed user, uint256 amount);
    event EscrowLinked(address indexed escrow);

    constructor(address _projectToken) {
        projectToken = IERC20(_projectToken);
        factory = msg.sender;
    }

    /**
     * @dev One-time initialization called by Factory during deployment.
     */
    function setMilestoneEscrow(address _milestoneEscrow) external {
        require(msg.sender == factory, "Only factory can link escrow");
        require(milestoneEscrow == address(0), "Escrow already linked");
        require(_milestoneEscrow != address(0), "Invalid escrow address");
        milestoneEscrow = _milestoneEscrow;
        emit EscrowLinked(_milestoneEscrow);
    }

    receive() external payable {
        require(totalStaked > 0, "No tokens staked to receive dividends");
        dividendPerToken += (msg.value * MAGNIFIER) / totalStaked;
        emit DividendsDeposited(msg.value);
    }

    modifier updateDividend(address account) {
        rewards[account] = getClaimableYield(account);
        userDividendPerTokenPaid[account] = dividendPerToken;
        _;
    }

    function getClaimableYield(address account) public view returns (uint256) {
        return
            (stakedBalance[account] *
                (dividendPerToken - userDividendPerTokenPaid[account])) /
            MAGNIFIER +
            rewards[account];
    }

    function stake(
        uint256 amount
    ) external nonReentrant updateDividend(msg.sender) {
        require(amount > 0, "Cannot stake 0");

        totalStaked += amount;
        stakedBalance[msg.sender] += amount;

        require(
            projectToken.transferFrom(msg.sender, address(this), amount),
            "Token transfer failed"
        );
        emit Staked(msg.sender, amount);
    }

    /**
     * @dev Unstaking is blocked while the user has an active vote on an ongoing milestone.
     */
    function withdraw(
        uint256 amount
    ) external nonReentrant updateDividend(msg.sender) {
        require(amount > 0, "Cannot withdraw 0");
        require(
            stakedBalance[msg.sender] >= amount,
            "Insufficient staked balance"
        );

        if (milestoneEscrow != address(0)) {
            require(
                !IMilestoneEscrow(milestoneEscrow).isUserVoteLocked(msg.sender),
                "Tokens locked in active milestone vote"
            );
        }

        totalStaked -= amount;
        stakedBalance[msg.sender] -= amount;

        require(
            projectToken.transfer(msg.sender, amount),
            "Token transfer failed"
        );
        emit Withdrawn(msg.sender, amount);
    }

    function claimYield() external nonReentrant updateDividend(msg.sender) {
        uint256 reward = rewards[msg.sender];
        require(reward > 0, "No yield available");

        rewards[msg.sender] = 0;

        (bool success, ) = msg.sender.call{value: reward}("");
        require(success, "ETH transfer failed");

        emit YieldClaimed(msg.sender, reward);
    }
}
