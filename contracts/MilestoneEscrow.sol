// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "./interfaces/IDividendDistributor.sol";
import "./interfaces/IForgeCapitaRegistry.sol";

interface IProjectToken is IERC20 {
    function emergencyInvalidate() external;
    function burn(uint256 amount) external;
}

contract MilestoneEscrow is Initializable, ReentrancyGuard {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    IProjectToken public projectToken;
    IDividendDistributor public dividendDistributor;

    address payable public developer;
    address payable public pendingDeveloper;
    IForgeCapitaRegistry public registry;

    uint256 public publicSupply;
    uint256 public developerSupply;
    uint256 public remainingPublicTokens;
    uint256 public totalRaised;
    uint256 public netFunds;

    bool public isFundingActive;
    bool public projectCancelled;
    bool public completed;

    uint256 public fundingGoal;
    uint256 public fundingDeadline;

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
    }

    Milestone[] public milestones;
    uint256 public currentMilestoneIndex;

    mapping(address => uint256) public deposits;
    mapping(address => bool) public hasClaimedTokens;
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    event DepositReceived(address indexed backer, uint256 amount);
    event VotingStarted(uint256 indexed milestoneIndex);
    event Voted(
        address indexed voter,
        uint256 indexed milestoneIndex,
        bool support,
        uint256 weight
    );
    event MilestoneExecuted(
        uint256 indexed milestoneIndex,
        uint256 amountReleased,
        uint256 tokensVested,
        uint256 gasDebtRecouped
    );
    event ProjectCancelled(string reason);
    event ProjectCompleted();
    event RefundClaimed(address indexed backer, uint256 amount);
    event PlatformFeeCollected(uint256 amount);
    event DeveloperTransferProposed(
        address indexed oldDeveloper,
        address indexed newDeveloper
    );
    event DeveloperTransferAccepted(
        address indexed oldDeveloper,
        address indexed newDeveloper
    );
    event EmergencyShutdownTriggered(
        uint256 extractedETH,
        uint256 burnedTokens
    );

    function initialize(
        address _projectToken,
        address payable _developer,
        uint256 _totalTokenSupply,
        string[] memory _milestoneDescriptions,
        uint256[] memory _milestonePercentages,
        uint256 _fundingGoal,
        uint256 _fundingDurationDays,
        address _registry,
        address _dividendDistributor
    ) public initializer {
        projectToken = IProjectToken(_projectToken);
        developer = _developer;
        dividendDistributor = IDividendDistributor(_dividendDistributor);
        registry = IForgeCapitaRegistry(_registry);

        developerSupply = (_totalTokenSupply * 20) / 100;
        publicSupply = _totalTokenSupply - developerSupply;
        remainingPublicTokens = publicSupply;

        fundingGoal = _fundingGoal;
        fundingDeadline = block.timestamp + (_fundingDurationDays * 1 days);
        isFundingActive = true;
        projectCancelled = false;

        require(
            _milestoneDescriptions.length == _milestonePercentages.length,
            "Array lengths must match"
        );
        require(
            _milestoneDescriptions.length > 0,
            "Must have at least one milestone"
        );
        require(
            _milestoneDescriptions.length <= 5,
            "Maximum of 5 milestones allowed"
        );

        uint256 totalPercentage = 0;
        for (uint256 i = 0; i < _milestoneDescriptions.length; i++) {
            totalPercentage += _milestonePercentages[i];
            milestones.push(
                Milestone({
                    description: _milestoneDescriptions[i],
                    unlockPercentage: _milestonePercentages[i],
                    isVotingOpen: false,
                    isExecuted: false,
                    yesVotes: 0,
                    noVotes: 0,
                    votingStartTime: 0
                })
            );
        }
        require(
            totalPercentage == 100,
            "Milestone percentages must equal exactly 100"
        );
    }

    receive() external payable {
        require(isFundingActive, "Funding phase is over");
        require(
            block.timestamp <= fundingDeadline,
            "Funding deadline has passed"
        );
        require(msg.sender != developer, "Developer cannot fund campaign");
        deposits[msg.sender] += msg.value;
        emit DepositReceived(msg.sender, msg.value);
    }

    /// @notice Fee recipient, read from the registry so it follows treasury rotation.
    function forgeCapitaTreasury() public view returns (address payable) {
        return registry.treasury();
    }

    function closeFundingAndStart() external {
        require(msg.sender == developer, "Only developer can call");
        require(isFundingActive, "Already closed");
        require(
            address(this).balance >= fundingGoal,
            "Funding goal not reached"
        );

        isFundingActive = false;
        totalRaised = address(this).balance;

        uint256 fee = (totalRaised * PLATFORM_FEE_PERCENT) / 100;
        netFunds = totalRaised - fee;

        (bool feeSuccess, ) = forgeCapitaTreasury().call{value: fee}("");
        require(feeSuccess, "Fee transfer failed");
        emit PlatformFeeCollected(fee);
    }

    function startMilestone(uint256 index) external {
        require(msg.sender == developer, "Only developer can request");
        require(!isFundingActive, "Funding still active");
        require(!projectCancelled, "Project cancelled");
        require(index == currentMilestoneIndex, "Invalid milestone index");
        require(!milestones[index].isVotingOpen, "Milestone already open");

        if (index > 0) {
            require(
                milestones[index - 1].isExecuted,
                "Previous milestone not executed"
            );
        }

        milestones[index].isVotingOpen = true;
        milestones[index].votingStartTime = block.timestamp;
        emit VotingStarted(index);
    }

    function claimTokens() external nonReentrant {
        require(!isFundingActive, "Funding phase is still active");
        require(!hasClaimedTokens[msg.sender], "Tokens already claimed");
        require(deposits[msg.sender] > 0, "No investment found");

        hasClaimedTokens[msg.sender] = true;
        uint256 tokenShare = (deposits[msg.sender] * publicSupply) /
            totalRaised;
        require(
            projectToken.transfer(msg.sender, tokenShare),
            "Token transfer failed"
        );
    }

    function vote(bool support) external nonReentrant {
        require(!isFundingActive, "Funding is still active");
        require(!projectCancelled, "Project has been cancelled");
        require(msg.sender != developer, "Developer cannot vote");

        Milestone storage milestone = milestones[currentMilestoneIndex];
        require(milestone.isVotingOpen, "Voting is not open");
        require(!hasVoted[currentMilestoneIndex][msg.sender], "Already voted");

        uint256 voterWeight = dividendDistributor.stakedBalance(msg.sender);
        require(voterWeight > 0, "No voting power (must stake tokens first)");

        hasVoted[currentMilestoneIndex][msg.sender] = true;
        if (support) milestone.yesVotes += voterWeight;
        else milestone.noVotes += voterWeight;

        emit Voted(msg.sender, currentMilestoneIndex, support, voterWeight);
    }

    /**
     * @dev Executes a milestone and recoups Paymaster gas debt via a Treasury-signed payload.
     * @param gasDebt The total accumulated excess gas debt owed to the Treasury.
     * @param signature The ECDSA signature from the forgeCapitaTreasury verifying the debt amount.
     */
    function executeMilestone(
        uint256 gasDebt,
        bytes calldata signature
    ) external nonReentrant {
        require(!projectCancelled, "Project cancelled");

        Milestone storage milestone = milestones[currentMilestoneIndex];
        require(milestone.isVotingOpen, "Voting is not open");

        bool fastTrackPassed = milestone.yesVotes > (publicSupply / 2);
        bool quorumPassed = (block.timestamp >=
            milestone.votingStartTime + VOTING_PERIOD) &&
            ((milestone.yesVotes + milestone.noVotes) >=
                (publicSupply * QUORUM_PERCENT) / 100) &&
            (milestone.yesVotes > milestone.noVotes);

        require(
            fastTrackPassed || quorumPassed,
            "Milestone approval conditions not met"
        );

        // Verify Gas Debt Signature (Option 2: Stateless Recoupment)
        bytes32 messageHash = keccak256(
            abi.encodePacked(
                address(this),
                currentMilestoneIndex,
                block.chainid,
                gasDebt
            )
        );
        bytes32 ethSignedMessageHash = messageHash.toEthSignedMessageHash();
        address recoveredSigner = ethSignedMessageHash.recover(signature);
        require(
            recoveredSigner == forgeCapitaTreasury(),
            "Invalid gas debt signature"
        );

        milestone.isExecuted = true;
        milestone.isVotingOpen = false;

        uint256 ethToRelease = (netFunds * milestone.unlockPercentage) / 100;
        require(ethToRelease >= gasDebt, "Gas debt exceeds milestone payout");

        uint256 developerNetPayout = ethToRelease - gasDebt;

        bool isFinalMilestone = (currentMilestoneIndex ==
            milestones.length - 1);
        currentMilestoneIndex++;
        if (isFinalMilestone) {
            completed = true;
            emit ProjectCompleted();
        }

        uint256 tokensVested = 0;
        if (isFinalMilestone) {
            tokensVested = developerSupply;
            require(
                projectToken.transfer(developer, tokensVested),
                "Token vesting transfer failed"
            );
        }

        // Pay the Treasury its recouped gas debt first
        if (gasDebt > 0) {
            (bool debtSuccess, ) = forgeCapitaTreasury().call{value: gasDebt}("");
            require(debtSuccess, "Treasury debt transfer failed");
        }

        // Pay the developer the remaining balance
        if (developerNetPayout > 0) {
            (bool devSuccess, ) = developer.call{value: developerNetPayout}("");
            require(devSuccess, "Developer ETH transfer failed");
        }

        emit MilestoneExecuted(
            currentMilestoneIndex - 1,
            developerNetPayout,
            tokensVested,
            gasDebt
        );
    }

    function isUserVoteLocked(address account) external view returns (bool) {
        if (
            projectCancelled ||
            completed ||
            currentMilestoneIndex >= milestones.length
        ) {
            return false;
        }
        Milestone storage milestone = milestones[currentMilestoneIndex];
        return
            milestone.isVotingOpen && hasVoted[currentMilestoneIndex][account];
    }

    function refundFailedCrowdfund() external nonReentrant {
        require(isFundingActive, "Funding already closed successfully");
        require(block.timestamp > fundingDeadline, "Deadline not reached yet");
        require(
            address(this).balance < fundingGoal,
            "Funding goal was reached"
        );

        uint256 invested = deposits[msg.sender];
        require(invested > 0, "No funds to refund");

        deposits[msg.sender] = 0;
        (bool success, ) = msg.sender.call{value: invested}("");
        require(success, "Refund failed");
    }

    function cancelProject(string calldata reason) external {
        require(
            msg.sender == developer || msg.sender == registry.guardian(),
            "Only developer or Guardian can cancel"
        );
        require(!isFundingActive, "Funding still active");
        require(!projectCancelled, "Project already cancelled");
        require(!completed, "Project is completed");
        projectCancelled = true;
        emit ProjectCancelled(reason);
    }

    function refundDeadProject() external nonReentrant {
        require(!isFundingActive, "Crowdfunding still active");
        require(!completed, "Project is completed");
        require(projectCancelled, "Project is not cancelled");
        require(msg.sender != developer, "Developer cannot claim refund");

        uint256 userTokens = projectToken.balanceOf(msg.sender);
        require(
            userTokens > 0,
            "No tokens to refund. Unstake from distributor first."
        );

        uint256 refundAmount = (userTokens * address(this).balance) /
            remainingPublicTokens;
        remainingPublicTokens -= userTokens;

        require(
            projectToken.transferFrom(msg.sender, address(this), userTokens),
            "Token surrender failed"
        );

        (bool success, ) = msg.sender.call{value: refundAmount}("");
        require(success, "Refund failed");
        emit RefundClaimed(msg.sender, refundAmount);
    }

    function proposeNewDeveloper(address payable _newDeveloper) external {
        require(
            msg.sender == developer || msg.sender == registry.guardian(),
            "Only active dev or Guardian can propose"
        );
        require(_newDeveloper != address(0), "Cannot transfer to zero address");
        pendingDeveloper = _newDeveloper;
        emit DeveloperTransferProposed(developer, _newDeveloper);
    }

    function acceptDeveloperRole() external {
        require(
            msg.sender == pendingDeveloper,
            "Only pending developer can accept"
        );
        address oldDeveloper = developer;
        developer = pendingDeveloper;
        pendingDeveloper = payable(address(0));
        emit DeveloperTransferAccepted(oldDeveloper, developer);
    }

    /**
     * @dev Emergency Circuit Breaker. Called by the Guardian to freeze operations, extract capital, and globally invalidate tokens.
     */
    function emergencyShutdown() external nonReentrant {
        require(
            msg.sender == registry.guardian(),
            "Only Guardian can trigger emergency shutdown"
        );
        require(!projectCancelled, "Project already cancelled");

        isFundingActive = false;
        projectCancelled = true;

        // 1. Total Supply Wipe (Global Invalidation)
        projectToken.emergencyInvalidate();

        // 2. Burn tokens physically locked in escrow
        uint256 escrowTokens = projectToken.balanceOf(address(this));
        if (escrowTokens > 0) {
            projectToken.burn(escrowTokens);
        }

        // 3. Extract remaining ETH to Treasury
        uint256 remainingETH = address(this).balance;
        if (remainingETH > 0) {
            (bool success, ) = forgeCapitaTreasury().call{
                value: remainingETH
            }("");
            require(success, "Emergency ETH extraction failed");
        }

        emit EmergencyShutdownTriggered(remainingETH, escrowTokens);
    }
}
