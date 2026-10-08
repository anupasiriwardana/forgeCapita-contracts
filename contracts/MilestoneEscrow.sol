// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract MilestoneEscrow is ReentrancyGuard {
    IERC20 public immutable projectToken;
    address payable public immutable developer;
    address payable public immutable forgeCapitaTreasury;
    
    uint256 public immutable totalSupply; 
    uint256 public totalRaised; // Gross amount for token math
    uint256 public netFunds;    // Amount left for developer after 5% fee
    
    bool public isFundingActive = true;
    bool public projectCancelled = false; 

    uint256 public immutable fundingGoal;
    uint256 public immutable fundingDeadline;
    
    uint256 public milestoneDeadline;
    uint256 public constant MAX_INACTIVITY_PERIOD = 90 days;
    uint256 public constant PLATFORM_FEE_PERCENT = 5;

    struct Milestone {
        string description;
        uint256 unlockPercentage; 
        bool isVotingOpen;
        bool isExecuted;
        uint256 yesVotes;
        uint256 noVotes;
    }
    
    Milestone[] public milestones;
    uint256 public currentMilestoneIndex;
    
    mapping(address => uint256) public deposits;
    mapping(address => bool) public hasClaimedTokens;
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    event DepositReceived(address indexed backer, uint256 amount);
    event VotingStarted(uint256 indexed milestoneIndex);
    event Voted(address indexed voter, uint256 indexed milestoneIndex, bool support, uint256 weight);
    event MilestoneExecuted(uint256 indexed milestoneIndex, uint256 amountReleased);
    event ProjectCancelled(string reason);
    event RefundClaimed(address indexed backer, uint256 amount);
    event PlatformFeeCollected(uint256 amount);

    constructor(
        address _projectToken, 
        address payable _developer, 
        uint256 _totalSupply,
        string[] memory _milestoneDescriptions,
        uint256[] memory _milestonePercentages,
        uint256 _fundingGoal,
        uint256 _fundingDurationDays,
        address payable _treasury
    ) {
        projectToken = IERC20(_projectToken);
        developer = _developer;
        totalSupply = _totalSupply;
        forgeCapitaTreasury = _treasury;
        
        fundingGoal = _fundingGoal;
        fundingDeadline = block.timestamp + (_fundingDurationDays * 1 days);
        
        require(_milestoneDescriptions.length == _milestonePercentages.length, "Array lengths must match");
        require(_milestoneDescriptions.length > 0, "Must have at least one milestone");
        require(_milestoneDescriptions.length <= 5, "Maximum of 5 milestones allowed");
        
        uint256 totalPercentage = 0;
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
        require(totalPercentage == 100, "Milestone percentages must equal exactly 100");
    }

    receive() external payable {
        require(isFundingActive, "Funding phase is over");
        require(block.timestamp <= fundingDeadline, "Funding deadline has passed");
        
        deposits[msg.sender] += msg.value;
        emit DepositReceived(msg.sender, msg.value);
    }

    function closeFundingAndStart() external {
        require(msg.sender == developer, "Only developer can call");
        require(isFundingActive, "Already closed");
        require(address(this).balance >= fundingGoal, "Funding goal not reached");
        
        isFundingActive = false;
        
        // 1. Calculate the 5% platform success fee
        totalRaised = address(this).balance; 
        uint256 fee = (totalRaised * PLATFORM_FEE_PERCENT) / 100;
        netFunds = totalRaised - fee; 
        
        // 2. Transfer the fee to ForgeCapita
        (bool feeSuccess, ) = forgeCapitaTreasury.call{value: fee}("");
        require(feeSuccess, "Fee transfer failed");
        emit PlatformFeeCollected(fee);

        // 3. Open Milestone 0
        milestones[0].isVotingOpen = true;
        milestoneDeadline = block.timestamp + MAX_INACTIVITY_PERIOD;
        emit VotingStarted(0);
    }

    function claimTokens() external nonReentrant {
        require(!isFundingActive, "Funding phase is still active");
        require(!hasClaimedTokens[msg.sender], "Tokens already claimed");
        require(deposits[msg.sender] > 0, "No investment found");
        
        hasClaimedTokens[msg.sender] = true;
        
        // Math uses gross totalRaised so investors still get 100% of the token supply
        uint256 tokenShare = (deposits[msg.sender] * totalSupply) / totalRaised;
        require(projectToken.transfer(msg.sender, tokenShare), "Token transfer failed");
    }

    function vote(bool support) external nonReentrant {
        require(!isFundingActive, "Funding is still active");
        require(!projectCancelled, "Project has been cancelled");
        
        Milestone storage milestone = milestones[currentMilestoneIndex];
        require(milestone.isVotingOpen, "Voting is not open");
        require(!hasVoted[currentMilestoneIndex][msg.sender], "Already voted");
        
        uint256 voterWeight = projectToken.balanceOf(msg.sender);
        require(voterWeight > 0, "No voting power (claim tokens first)");
        
        hasVoted[currentMilestoneIndex][msg.sender] = true;
        if (support) milestone.yesVotes += voterWeight;
        else milestone.noVotes += voterWeight;
        
        emit Voted(msg.sender, currentMilestoneIndex, support, voterWeight);
    }

    function executeMilestone() external nonReentrant {
        require(!projectCancelled, "Project cancelled");
        require(block.timestamp <= milestoneDeadline, "Milestone deadline passed. Project in deadlock.");
        
        Milestone storage milestone = milestones[currentMilestoneIndex];
        require(milestone.isVotingOpen, "Voting is not open");
        require(milestone.yesVotes > (totalSupply / 2), "Not enough Yes votes");
        
        milestone.isExecuted = true;
        milestone.isVotingOpen = false;
        
        // Developer payouts are based strictly on the netFunds remaining after the platform fee
        uint256 amountToRelease = (netFunds * milestone.unlockPercentage) / 100;
        currentMilestoneIndex++;
        
        if (currentMilestoneIndex < milestones.length) {
            milestoneDeadline = block.timestamp + MAX_INACTIVITY_PERIOD;
        }

        (bool success, ) = developer.call{value: amountToRelease}("");
        require(success, "ETH transfer failed");
        emit MilestoneExecuted(currentMilestoneIndex - 1, amountToRelease);
    }

    function requestNextMilestone() external {
        require(msg.sender == developer, "Only developer can request");
        require(!projectCancelled, "Project cancelled");
        require(currentMilestoneIndex < milestones.length, "All milestones completed");
        require(milestones[currentMilestoneIndex - 1].isExecuted, "Previous milestone not executed");
        
        milestones[currentMilestoneIndex].isVotingOpen = true;
        emit VotingStarted(currentMilestoneIndex);
    }

    function refundFailedCrowdfund() external nonReentrant {
        require(isFundingActive, "Funding already closed successfully");
        require(block.timestamp > fundingDeadline, "Deadline not reached yet");
        require(address(this).balance < fundingGoal, "Funding goal was reached");

        uint256 invested = deposits[msg.sender];
        require(invested > 0, "No funds to refund");

        deposits[msg.sender] = 0; 

        (bool success, ) = msg.sender.call{value: invested}("");
        require(success, "Refund failed");
    }

    function cancelProject(string calldata reason) external {
        require(msg.sender == developer, "Only developer can cancel");
        require(!isFundingActive, "Funding still active");
        
        projectCancelled = true;
        emit ProjectCancelled(reason);
    }

    function refundDeadProject() external nonReentrant {
        require(!isFundingActive, "Crowdfunding still active");
        require(projectCancelled || block.timestamp > milestoneDeadline, "Project is still healthy");
        
        uint256 userTokens = projectToken.balanceOf(msg.sender);
        require(userTokens > 0, "No tokens to refund. Did you call claimTokens()?");

        uint256 activeTokens = totalSupply - projectToken.balanceOf(address(this));
        uint256 refundAmount = (userTokens * address(this).balance) / activeTokens;

        require(projectToken.transferFrom(msg.sender, address(this), userTokens), "Token surrender failed");

        (bool success, ) = msg.sender.call{value: refundAmount}("");
        require(success, "Refund failed");
        
        emit RefundClaimed(msg.sender, refundAmount);
    }
}