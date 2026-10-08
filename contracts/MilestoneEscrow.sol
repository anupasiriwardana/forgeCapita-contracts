// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

// Interface needed to call OpenZeppelin's snapshot function
interface IVotes {
    function getPastVotes(address account, uint256 timepoint) external view returns (uint256);
}

contract MilestoneEscrow is ReentrancyGuard {
    IERC20 public immutable projectToken;
    address payable public developer;
    address payable public pendingDeveloper; // For developer replacement
    address payable public immutable forgeCapitaTreasury;
    
    uint256 public immutable publicSupply; 
    uint256 public immutable developerSupply;
    uint256 public remainingPublicTokens;
    uint256 public totalRaised; 
    uint256 public netFunds;    
    
    bool public isFundingActive = true;
    bool public projectCancelled = false; 

    uint256 public immutable fundingGoal;
    uint256 public immutable fundingDeadline;
    
    uint256 public milestoneDeadline;
    uint256 public constant MAX_INACTIVITY_PERIOD = 120 days;
    uint256 public constant PLATFORM_FEE_PERCENT = 5;
    uint256 public constant VOTING_PERIOD = 28 days;
    uint256 public constant QUORUM_PERCENT = 20;

    struct Milestone {
        string description;
        uint256 unlockPercentage; 
        bool isVotingOpen;
        bool isExecuted;
        uint256 yesVotes;
        uint256 noVotes;
        uint256 votingStartTime; 
        uint256 votingStartBlock; // Added to anchor the voting snapshot
    }
    
    Milestone[] public milestones;
    uint256 public currentMilestoneIndex;
    
    mapping(address => uint256) public deposits;
    mapping(address => bool) public hasClaimedTokens;
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    event DepositReceived(address indexed backer, uint256 amount);
    event VotingStarted(uint256 indexed milestoneIndex);
    event Voted(address indexed voter, uint256 indexed milestoneIndex, bool support, uint256 weight);
    event MilestoneExecuted(uint256 indexed milestoneIndex, uint256 amountReleased, uint256 tokensVested);
    event ProjectCancelled(string reason);
    event RefundClaimed(address indexed backer, uint256 amount);
    event PlatformFeeCollected(uint256 amount);
    event DeveloperTransferProposed(address indexed oldDeveloper, address indexed newDeveloper);
    event DeveloperTransferAccepted(address indexed oldDeveloper, address indexed newDeveloper);

    constructor(
        address _projectToken, 
        address payable _developer, 
        uint256 _totalTokenSupply,
        string[] memory _milestoneDescriptions,
        uint256[] memory _milestonePercentages,
        uint256 _fundingGoal,
        uint256 _fundingDurationDays,
        address payable _treasury
    ) {
        projectToken = IERC20(_projectToken);
        developer = _developer;
        
        developerSupply = (_totalTokenSupply * 20) / 100;
        publicSupply = _totalTokenSupply - developerSupply;
        remainingPublicTokens = publicSupply;
        
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
                noVotes: 0,
                votingStartTime: 0,
                votingStartBlock: 0
            }));
        }
        require(totalPercentage == 100, "Milestone percentages must equal exactly 100");
    }

    receive() external payable {
        require(isFundingActive, "Funding phase is over");
        require(block.timestamp <= fundingDeadline, "Funding deadline has passed");
        require(msg.sender != developer, "Developer cannot fund campaign");
        
        deposits[msg.sender] += msg.value;
        emit DepositReceived(msg.sender, msg.value);
    }

    // 1. Remove the Milestone 0 activation from closeFundingAndStart()
    function closeFundingAndStart() external {
        require(msg.sender == developer, "Only developer can call");
        require(isFundingActive, "Already closed");
        require(address(this).balance >= fundingGoal, "Funding goal not reached");
        
        isFundingActive = false;
        totalRaised = address(this).balance; 
        uint256 fee = (totalRaised * PLATFORM_FEE_PERCENT) / 100;
        netFunds = totalRaised - fee; 
        
        (bool feeSuccess, ) = forgeCapitaTreasury.call{value: fee}("");
        require(feeSuccess, "Fee transfer failed");
        emit PlatformFeeCollected(fee);
        
        // DO NOT start Milestone 0 here.
    }

    // 2. Combine the milestone triggers into one universal function
    function startMilestone(uint256 index) external {
        require(msg.sender == developer, "Only developer can request");
        require(!isFundingActive, "Funding still active");
        require(!projectCancelled, "Project cancelled");
        require(index == currentMilestoneIndex, "Invalid milestone index");
        require(!milestones[index].isVotingOpen, "Milestone already open");
        
        if (index > 0) {
            require(milestones[index - 1].isExecuted, "Previous milestone not executed");
        }
        
        milestones[index].isVotingOpen = true;
        milestones[index].votingStartTime = block.timestamp;
        milestones[index].votingStartBlock = block.number; // Snapshot taken NOW
        
        if (index == 0) {
             milestoneDeadline = block.timestamp + MAX_INACTIVITY_PERIOD;
        }
        
        emit VotingStarted(index);
    }

    function claimTokens() external nonReentrant {
        require(!isFundingActive, "Funding phase is still active");
        require(!hasClaimedTokens[msg.sender], "Tokens already claimed");
        require(deposits[msg.sender] > 0, "No investment found");
        
        hasClaimedTokens[msg.sender] = true;
        
        uint256 tokenShare = (deposits[msg.sender] * publicSupply) / totalRaised;
        require(projectToken.transfer(msg.sender, tokenShare), "Token transfer failed");
    }

    function vote(bool support) external nonReentrant {
        require(!isFundingActive, "Funding is still active");
        require(!projectCancelled, "Project has been cancelled");
        require(msg.sender != developer, "Developer cannot vote");
        
        Milestone storage milestone = milestones[currentMilestoneIndex];
        require(milestone.isVotingOpen, "Voting is not open");
        require(!hasVoted[currentMilestoneIndex][msg.sender], "Already voted");
        
        // Prevent same-block flash loans by enforcing a 1 block delay to read past votes
        require(block.number > milestone.votingStartBlock, "Must wait 1 block to vote");
        
        // Query historical snapshot instead of live balance
        uint256 voterWeight = IVotes(address(projectToken)).getPastVotes(msg.sender, milestone.votingStartBlock);
        require(voterWeight > 0, "No voting power (ensure you claimed and delegated)");
        
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

        bool fastTrackPassed = milestone.yesVotes > (publicSupply / 2);
        bool quorumPassed = (block.timestamp >= milestone.votingStartTime + VOTING_PERIOD) &&
            ((milestone.yesVotes + milestone.noVotes) >= (publicSupply * QUORUM_PERCENT) / 100) &&
            (milestone.yesVotes > milestone.noVotes);

        require(fastTrackPassed || quorumPassed, "Milestone approval conditions not met");
        
        milestone.isExecuted = true;
        milestone.isVotingOpen = false;
        
        uint256 ethToRelease = (netFunds * milestone.unlockPercentage) / 100;
        bool isFinalMilestone = (currentMilestoneIndex == milestones.length - 1);
        
        currentMilestoneIndex++;
        
        if (currentMilestoneIndex < milestones.length) {
            milestoneDeadline = block.timestamp + MAX_INACTIVITY_PERIOD;
        }

        uint256 tokensVested = 0;
        if (isFinalMilestone) {
            tokensVested = developerSupply;
            require(projectToken.transfer(developer, tokensVested), "Token vesting transfer failed");
        }

        (bool success, ) = developer.call{value: ethToRelease}("");
        require(success, "ETH transfer failed");
        
        emit MilestoneExecuted(currentMilestoneIndex - 1, ethToRelease, tokensVested);
    }

    function requestNextMilestone() external {
        require(msg.sender == developer, "Only developer can request");
        require(!projectCancelled, "Project cancelled");
        require(currentMilestoneIndex < milestones.length, "All milestones completed");
        require(milestones[currentMilestoneIndex - 1].isExecuted, "Previous milestone not executed");
        
        milestones[currentMilestoneIndex].isVotingOpen = true;
        milestones[currentMilestoneIndex].votingStartTime = block.timestamp;
        milestones[currentMilestoneIndex].votingStartBlock = block.number; // Anchor snapshot
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
        require(msg.sender != developer, "Developer cannot claim refund");
        
        uint256 userTokens = projectToken.balanceOf(msg.sender);
        require(userTokens > 0, "No tokens to refund. Did you call claimTokens()?");

        uint256 refundAmount = (userTokens * address(this).balance) / remainingPublicTokens;
        remainingPublicTokens -= userTokens;

        require(projectToken.transferFrom(msg.sender, address(this), userTokens), "Token surrender failed");

        (bool success, ) = msg.sender.call{value: refundAmount}("");
        require(success, "Refund failed");
        
        emit RefundClaimed(msg.sender, refundAmount);
    }

    // Developer replacement functions
    // Step 1: Current developer initiates the transfer
    function proposeNewDeveloper(address payable _newDeveloper) external {
        require(msg.sender == developer, "Only active developer can propose");
        require(_newDeveloper != address(0), "Cannot transfer to zero address");
        
        pendingDeveloper = _newDeveloper;
        emit DeveloperTransferProposed(developer, _newDeveloper);
    }

    // Step 2: New developer accepts the role
    function acceptDeveloperRole() external {
        require(msg.sender == pendingDeveloper, "Only pending developer can accept");
        
        address oldDeveloper = developer;
        developer = pendingDeveloper;
        pendingDeveloper = payable(address(0)); // Lock the pending slot
        
        emit DeveloperTransferAccepted(oldDeveloper, developer);
    }
}