// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MilestoneEscrow
 * @dev Locks investor funds and releases them to the developer in tranches 
 * based on decentralized voting by ForgeCapita Project Token holders.
 */
contract MilestoneEscrow is ReentrancyGuard {
    IERC20 public immutable projectToken; // The ERC-20 token representing fractional equity or yield claims for the startup
    address payable public immutable developer;
    
    // Used to calculate absolute majority without relying on dynamic circulating supplies
    uint256 public immutable totalSupply;  // The total supply of the Project Token at the time of escrow creation
    uint256 public totalRaised; // total amount of ETH the project successfully crowdfunded
    bool public isFundingActive = true;

    struct Milestone {
        string description;
        uint256 unlockPercentage; // e.g., 40 for 40%
        bool isVotingOpen;
        bool isExecuted;
        uint256 yesVotes;
        uint256 noVotes;
    }

    Milestone[] public milestones;
    uint256 public currentMilestoneIndex;

        // Prevents double-voting: milestoneIndex => userAddress => hasVoted
    mapping(uint256 => mapping(address => bool)) public hasVoted;
        // Tracks the exact amount of ETH each investor deposited
    mapping(address => uint256) public deposits;  
        // Security check to prevent double-claiming
    mapping(address => bool) public hasClaimedTokens;


    event DepositReceived(address indexed backer, uint256 amount);
    event VotingStarted(uint256 indexed milestoneIndex);
    event Voted(address indexed voter, uint256 indexed milestoneIndex, bool support, uint256 weight);
    event MilestoneExecuted(uint256 indexed milestoneIndex, uint256 amountReleased);

    // constructor(address _projectToken, address payable _developer, uint256 _totalSupply) {
    //     projectToken = IERC20(_projectToken);
    //     developer = _developer;
    //     totalSupply = _totalSupply;

    //     // Define the startup's roadmap tranches
    //     milestones.push(Milestone("Initial Setup & Design", 40, false, false, 0, 0));
    //     milestones.push(Milestone("Beta Release", 30, false, false, 0, 0));
    //     milestones.push(Milestone("Mainnet Launch", 30, false, false, 0, 0));
    // }

    // Inside MilestoneEscrow.sol

    constructor(
        address _projectToken, 
        address payable _developer, 
        uint256 _totalSupply,
        string[] memory _milestoneDescriptions,
        uint256[] memory _milestonePercentages
    ) {
        projectToken = IERC20(_projectToken);
        developer = _developer;
        totalSupply = _totalSupply;

        // 1. Security Checks
        require(_milestoneDescriptions.length == _milestonePercentages.length, "Array lengths must match");
        require(_milestoneDescriptions.length > 0, "Must have at least one milestone");
        require(_milestoneDescriptions.length <= 5, "Maximum of 5 milestones allowed");

        uint256 totalPercentage = 0;

        // 2. Loop through the arrays and build the roadmap
        for (uint256 i = 0; i < _milestoneDescriptions.length; i++) {
            totalPercentage += _milestonePercentages[i];
            
            milestones.push(Milestone({
                description: _milestoneDescriptions[i],
                unlockPercentage: _milestonePercentages[i],
                isVotingOpen: false,
                isExecuted: false,
                yesVotes: 0,
                noVotes: 0
            }));
        }

        // 3. The 100% Rule
        require(totalPercentage == 100, "Milestone percentages must equal exactly 100");
    }

    /**
     * @dev Investors send ETH directly to the contract to fund the project.
     */
    receive() external payable {
        require(isFundingActive, "Funding phase is over");

        // Record the investment
        deposits[msg.sender] += msg.value;
        
        emit DepositReceived(msg.sender, msg.value);
    }

    /**
     * @dev Locks the total raised amount so percentages calculate correctly, 
     * and opens voting for the very first milestone.
     */
    function closeFundingAndStart() external {
        require(msg.sender == developer, "Only developer can call");
        require(isFundingActive, "Already closed");
        
        isFundingActive = false;
        totalRaised = address(this).balance;
        milestones[0].isVotingOpen = true;
        
        emit VotingStarted(0);
    }


    /**
     * @dev Investors call this after crowdfunding ends to withdraw their equity.
     */
    function claimTokens() external nonReentrant {
        require(!isFundingActive, "Funding phase is still active");
        require(!hasClaimedTokens[msg.sender], "Tokens already claimed");
        require(deposits[msg.sender] > 0, "No investment found");

        // Lock their claim status immediately to prevent reentrancy attacks
        hasClaimedTokens[msg.sender] = true;

        // Proportional Math: (User's ETH * Total Supply) / Total ETH Raised
        // We multiply before dividing to prevent Solidity's zero-decimal precision loss!
        uint256 tokenShare = (deposits[msg.sender] * totalSupply) / totalRaised;

        // Transfer the ACME tokens from the Escrow vault to the investor
        require(projectToken.transfer(msg.sender, tokenShare), "Token transfer failed");
    }


    /**
     * @dev Token holders cast their vote. Voting weight equals their token balance.
     */
    function vote(bool support) external nonReentrant {
        require(!isFundingActive, "Funding is still active");
        
        Milestone storage milestone = milestones[currentMilestoneIndex];
        require(milestone.isVotingOpen, "Voting is not open for current milestone");
        require(!hasVoted[currentMilestoneIndex][msg.sender], "You have already voted");

        uint256 voterWeight = projectToken.balanceOf(msg.sender);
        require(voterWeight > 0, "No voting power");

        // Lock the user's vote
        hasVoted[currentMilestoneIndex][msg.sender] = true;

        if (support) {
            milestone.yesVotes += voterWeight;
        } else {
            milestone.noVotes += voterWeight;
        }

        emit Voted(msg.sender, currentMilestoneIndex, support, voterWeight);
    }

    /**
     * @dev Anyone can trigger the execution if the 'yes' votes achieve an absolute majority.
     */
    function executeMilestone() external nonReentrant {
        Milestone storage milestone = milestones[currentMilestoneIndex];
        require(milestone.isVotingOpen, "Voting is not open");
        require(!milestone.isExecuted, "Already executed");

        // Absolute Majority: Yes votes must exceed 50% of the entire token supply
        require(milestone.yesVotes > (totalSupply / 2), "Not enough Yes votes");

        milestone.isExecuted = true;
        milestone.isVotingOpen = false;

        uint256 amountToRelease = (totalRaised * milestone.unlockPercentage) / 100;
        
        // Advance the pointer to the next milestone
        currentMilestoneIndex++;

        (bool success, ) = developer.call{value: amountToRelease}("");
        require(success, "ETH transfer failed");

        emit MilestoneExecuted(currentMilestoneIndex - 1, amountToRelease);
    }

    /**
     * @dev Developer requests funds for the next stage once the previous is completed.
     */
    function requestNextMilestone() external {
        require(msg.sender == developer, "Only developer can request");
        require(currentMilestoneIndex < milestones.length, "All milestones completed");
        
        Milestone storage previousMilestone = milestones[currentMilestoneIndex - 1];
        Milestone storage nextMilestone = milestones[currentMilestoneIndex];
        
        require(previousMilestone.isExecuted, "Previous milestone not executed");
        require(!nextMilestone.isVotingOpen, "Voting already open");

        nextMilestone.isVotingOpen = true;
        emit VotingStarted(currentMilestoneIndex);
    }
}