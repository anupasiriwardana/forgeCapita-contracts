// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import "./interfaces/IDividendDistributor.sol";
import "./interfaces/IForgeCapitaRegistry.sol";
import "./libraries/SponsoredGasCost.sol";

interface IProjectToken is IERC20 {
    function emergencyInvalidate() external;
    function burn(uint256 amount) external;
    function isInvalidated() external view returns (bool);
}

contract MilestoneEscrow is Initializable, ReentrancyGuard, EIP712 {
    bytes32 private constant VOTE_TYPEHASH =
        keccak256("Vote(address voter,uint256 milestoneIndex,bool support,uint256 deadline)");

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
    /// @notice Timestamp at which projectCancelled was set (0 while not cancelled).
    uint256 public cancelledAt;

    uint256 public fundingGoal;
    uint256 public fundingDeadline;

    uint256 public constant PLATFORM_FEE_PERCENT = 5;
    uint256 public constant VOTING_PERIOD = 28 days;
    uint256 public constant QUORUM_PERCENT = 20;
    /// @notice Cap, in basis points of netFunds, on total sponsored gas the project can owe beyond the budget,
    /// and on the share of any single milestone payout that can be deducted to repay it.
    uint256 public constant MAX_DEBT_BPS = 1500;
    /// @notice Longest single freeze; it lapses on its own, no transaction needed.
    uint256 public constant MAX_FREEZE_DURATION = 45 days;
    /// @notice Cap on the cumulative time a project can ever be frozen.
    uint256 public constant MAX_TOTAL_FREEZE = 90 days;
    /// @notice After a cancel the guardian may shut the project down only when every public token is
    /// refunded or this long has passed since the cancel.
    uint256 public constant REFUND_WINDOW = 90 days;
    /// @notice After the funding deadline the developer has this long to close a funded campaign;
    /// once it passes, investors may refund even though the goal was met.
    uint256 public constant CLOSE_GRACE = 14 days;

    /// @dev Registry action kinds (Claim, Stake, Vote, Execute = 0..3).
    uint8 private constant ACTION_CLAIM = 0;
    uint8 private constant ACTION_VOTE = 2;
    uint8 private constant ACTION_EXECUTE = 3;

    /// @notice Gas ledger. gasBudget is the platform fee already paid to the treasury at close;
    /// gasSpent is what relayers have spent on this project; gasRecovered is what payouts have repaid
    /// from the part of gasSpent that exceeded the budget.
    uint256 public gasBudget;
    uint256 public gasSpent;
    uint256 public gasRecovered;

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

    /// @notice Freeze state. freezeStart is non-zero while a freeze is recorded but not yet settled
    /// (it may already have lapsed); frozenUntil is its effective end; totalFrozen is the settled
    /// cumulative frozen time. A lapsed freeze is settled lazily by the next freeze.
    uint256 public freezeStart;
    uint256 public frozenUntil;
    uint256 public totalFrozen;

    /// @notice Frozen time already accumulated when each milestone's vote started; the vote is extended
    /// by the time frozen since.
    mapping(uint256 => uint256) public frozenAtVoteStart;

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
    event SponsoredGas(
        address indexed relayer,
        address indexed account,
        uint8 action,
        uint256 cost,
        uint256 gasSpent
    );
    event GasDebtRecovered(
        uint256 indexed milestoneIndex,
        uint256 amount,
        uint256 outstanding
    );
    event GasDebtWrittenOff(uint256 amount);
    event ProjectCancelled(string reason);
    /// @notice Voting ended without approval; the project is cancelled and refunds open.
    event MilestoneFailed(uint256 index);
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
    /// @dev `until` is the effective end of this freeze; `totalFrozen` is the cumulative frozen time
    /// if it runs to that end.
    event MilestonesFrozen(uint256 until, uint256 totalFrozen);
    /// @dev `totalFrozen` is the actual cumulative frozen time after this early unfreeze.
    event MilestonesUnfrozen(uint256 totalFrozen);

    constructor() EIP712("ForgeCapita MilestoneEscrow", "1") {
        _disableInitializers();
    }

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
            block.timestamp <= fundingDeadline + CLOSE_GRACE,
            "Close window ended"
        );
        require(
            address(this).balance >= fundingGoal,
            "Funding goal not reached"
        );

        isFundingActive = false;
        totalRaised = address(this).balance;

        uint256 fee = (totalRaised * PLATFORM_FEE_PERCENT) / 100;
        netFunds = totalRaised - fee;
        gasBudget = fee;

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
        frozenAtVoteStart[index] = _frozenNow();
        emit VotingStarted(index);
    }

    function claimTokens() external nonReentrant {
        _claimTokens(msg.sender);
    }

    /// @notice Permissionless: delivers `account`'s tokens to `account`, never to the caller.
    /// When the caller is an allow-listed relayer the cost is recorded in the gas ledger.
    function claimTokensFor(address account) external nonReentrant {
        uint256 gasAtEntry = gasleft();
        _claimTokens(account);
        _recordGas(account, ACTION_CLAIM, gasAtEntry, SponsoredGasCost.CLAIM_OVERHEAD);
    }

    function _claimTokens(address account) private {
        require(!isFundingActive, "Funding phase is still active");
        require(!hasClaimedTokens[account], "Tokens already claimed");
        require(deposits[account] > 0, "No investment found");

        hasClaimedTokens[account] = true;
        uint256 tokenShare = (deposits[account] * publicSupply) / totalRaised;
        require(
            projectToken.transfer(account, tokenShare),
            "Token transfer failed"
        );
    }

    function vote(bool support) external nonReentrant {
        _vote(msg.sender, support);
    }

    /// @notice Casts `voter`'s vote from an EIP-712 signature (EOA or ERC-1271). Callable by anyone.
    /// The signed message binds the current milestone index; hasVoted makes it single-use.
    function voteBySig(
        address voter,
        bool support,
        uint256 deadline,
        bytes calldata signature
    ) external nonReentrant {
        uint256 gasAtEntry = gasleft();
        require(block.timestamp <= deadline, "Vote signature expired");
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    VOTE_TYPEHASH,
                    voter,
                    currentMilestoneIndex,
                    support,
                    deadline
                )
            )
        );
        require(
            SignatureChecker.isValidSignatureNow(voter, digest, signature),
            "Invalid vote signature"
        );
        _vote(voter, support);
        _recordGas(voter, ACTION_VOTE, gasAtEntry, SponsoredGasCost.VOTE_OVERHEAD);
    }

    function _vote(address voter, bool support) private {
        require(!isFundingActive, "Funding is still active");
        require(!projectCancelled, "Project has been cancelled");
        require(voter != developer, "Developer cannot vote");

        Milestone storage milestone = milestones[currentMilestoneIndex];
        require(milestone.isVotingOpen, "Voting is not open");
        require(block.timestamp < _votingEnd(currentMilestoneIndex), "Voting period ended");
        require(!hasVoted[currentMilestoneIndex][voter], "Already voted");

        uint256 voterWeight = dividendDistributor.stakedBalance(voter);
        require(voterWeight > 0, "No voting power (must stake tokens first)");

        hasVoted[currentMilestoneIndex][voter] = true;
        if (support) milestone.yesVotes += voterWeight;
        else milestone.noVotes += voterWeight;

        emit Voted(voter, currentMilestoneIndex, support, voterWeight);
    }

    /// @notice Executes the current milestone once approved. Callable by anyone.
    /// Sponsored gas above the budget is repaid to the treasury from the payout (at most 15% of it);
    /// the remainder carries to the next milestone and is written off after the final one.
    /// Once the voting period has ended without approval the call does not revert: it cancels the
    /// project (refunds open), emits MilestoneFailed, pays nobody and books no gas.
    function executeMilestone() external nonReentrant {
        uint256 gasAtEntry = gasleft();
        require(!projectCancelled, "Project cancelled");

        uint256 index = currentMilestoneIndex;
        Milestone storage milestone = milestones[index];
        require(milestone.isVotingOpen, "Voting is not open");

        bool fastTrackPassed = milestone.yesVotes > (publicSupply / 2);
        bool votingEnded = block.timestamp >= _votingEnd(index);
        bool quorumPassed = votingEnded &&
            ((milestone.yesVotes + milestone.noVotes) >=
                (publicSupply * QUORUM_PERCENT) / 100) &&
            (milestone.yesVotes > milestone.noVotes);

        if (!fastTrackPassed && !quorumPassed) {
            require(votingEnded, "Milestone approval conditions not met");
            projectCancelled = true;
            cancelledAt = block.timestamp;
            emit MilestoneFailed(index);
            return;
        }
        require(!isFrozen(), "Milestones frozen");

        bool isFinalMilestone = (index == milestones.length - 1);

        // The deduction below must include this call's own cost, but the payouts run after it, so the
        // payout work is covered by fixed overhead constants instead of being measured (design section 5).
        _recordGas(
            address(0),
            ACTION_EXECUTE,
            gasAtEntry,
            SponsoredGasCost.EXECUTE_OVERHEAD + (isFinalMilestone ? SponsoredGasCost.EXECUTE_FINAL_EXTRA : 0)
        );

        milestone.isExecuted = true;
        milestone.isVotingOpen = false;

        currentMilestoneIndex = index + 1;

        uint256 ethToRelease = (netFunds * milestone.unlockPercentage) / 100;
        uint256 deduction = _settleGasDebt(index, ethToRelease, isFinalMilestone);
        uint256 developerNetPayout = ethToRelease - deduction;

        uint256 tokensVested = 0;
        if (isFinalMilestone) {
            completed = true;
            emit ProjectCompleted();
            tokensVested = developerSupply;
            require(
                projectToken.transfer(developer, tokensVested),
                "Token vesting transfer failed"
            );
        }

        if (deduction > 0) {
            (bool debtSuccess, ) = forgeCapitaTreasury().call{value: deduction}("");
            require(debtSuccess, "Treasury debt transfer failed");
        }

        if (developerNetPayout > 0) {
            (bool devSuccess, ) = developer.call{value: developerNetPayout}("");
            require(devSuccess, "Developer ETH transfer failed");
        }

        emit MilestoneExecuted(index, developerNetPayout, tokensVested, deduction);
    }

    /// @dev Cumulative frozen time up to now: settled time plus the elapsed part of the recorded freeze
    /// (capped at its effective end, so a lapsed freeze counts exactly its length).
    function _frozenNow() private view returns (uint256) {
        if (freezeStart == 0) return totalFrozen;
        uint256 end = block.timestamp < frozenUntil ? block.timestamp : frozenUntil;
        return totalFrozen + (end - freezeStart);
    }

    function _votingEnd(uint256 index) private view returns (uint256) {
        return milestones[index].votingStartTime + VOTING_PERIOD + (_frozenNow() - frozenAtVoteStart[index]);
    }

    /// @notice Current end of the voting period of an opened milestone: the 28 days plus any time the
    /// project has been frozen since the vote started. Moves later while a freeze is running.
    function votingEndTime(uint256 index) external view returns (uint256) {
        require(index < milestones.length, "Invalid milestone index");
        require(milestones[index].votingStartTime != 0, "Voting not started");
        return _votingEnd(index);
    }

    /// @notice True while a freeze is active. Lapses by itself at frozenUntil.
    function isFrozen() public view returns (bool) {
        return freezeStart != 0 && block.timestamp < frozenUntil;
    }

    /// @notice Guardian blocks executeMilestone for up to 45 days (cumulative cap 90 days).
    /// Only executeMilestone is affected; voting, staking, claims, refunds, cancel and shutdown keep working.
    function freezeMilestones() external {
        require(msg.sender == registry.guardian(), "Only Guardian can freeze");
        require(!isFundingActive, "Funding still active");
        require(!projectCancelled, "Project cancelled");
        require(!completed, "Project is completed");
        require(!isFrozen(), "Already frozen");

        // A lapsed freeze is still recorded: settle its full effective length first.
        uint256 settled = totalFrozen;
        if (freezeStart != 0) settled += frozenUntil - freezeStart;
        require(settled < MAX_TOTAL_FREEZE, "Freeze limit reached");

        uint256 duration = MAX_TOTAL_FREEZE - settled;
        if (duration > MAX_FREEZE_DURATION) duration = MAX_FREEZE_DURATION;

        totalFrozen = settled;
        freezeStart = block.timestamp;
        frozenUntil = block.timestamp + duration;
        emit MilestonesFrozen(frozenUntil, settled + duration);
    }

    /// @notice Guardian ends an active freeze early; only the time actually frozen is counted.
    function unfreezeMilestones() external {
        require(msg.sender == registry.guardian(), "Only Guardian can unfreeze");
        require(isFrozen(), "Not frozen");

        totalFrozen += block.timestamp - freezeStart;
        freezeStart = 0;
        frozenUntil = 0;
        emit MilestonesUnfrozen(totalFrozen);
    }

    /// @dev Computes and books the deduction for this payout (design section 5).
    function _settleGasDebt(
        uint256 index,
        uint256 ethToRelease,
        bool isFinalMilestone
    ) private returns (uint256 deduction) {
        uint256 overflow = gasSpent > gasBudget ? gasSpent - gasBudget : 0;
        uint256 outstanding = overflow - gasRecovered;
        uint256 cap = (ethToRelease * MAX_DEBT_BPS) / 10_000;
        deduction = outstanding < cap ? outstanding : cap;
        gasRecovered += deduction;
        outstanding -= deduction;
        if (deduction > 0) emit GasDebtRecovered(index, deduction, outstanding);
        if (isFinalMilestone && outstanding > 0) emit GasDebtWrittenOff(outstanding);
    }

    /// @notice Called by this project's distributor to book a relayer-sponsored stake.
    function recordSponsoredGas(
        address relayer,
        address account,
        uint8 action,
        uint256 cost
    ) external {
        require(msg.sender == address(dividendDistributor), "Only distributor");
        _bookGas(relayer, account, action, cost);
    }

    /// @dev Records the cost of the current call only when it comes from an allow-listed relayer.
    function _recordGas(address account, uint8 action, uint256 gasAtEntry, uint256 overhead) private {
        if (!registry.isRelayer(msg.sender)) return;
        _bookGas(
            msg.sender,
            account,
            action,
            SponsoredGasCost.cost(registry, action, gasAtEntry, msg.data.length, overhead)
        );
    }

    /// @dev Reverts above the exposure ceiling. Before funding closes gasBudget and netFunds are 0,
    /// so any sponsored call with a non-zero cost reverts.
    function _bookGas(address relayer, address account, uint8 action, uint256 cost) private {
        gasSpent += cost;
        require(
            gasSpent <= gasBudget + (netFunds * MAX_DEBT_BPS) / 10_000,
            "Gas ceiling exceeded"
        );
        emit SponsoredGas(relayer, account, action, cost, gasSpent);
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
            address(this).balance < fundingGoal ||
                block.timestamp > fundingDeadline + CLOSE_GRACE,
            "Close window still open"
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
        cancelledAt = block.timestamp;
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
        require(!projectToken.isInvalidated(), "Already shut down");
        if (projectCancelled) {
            require(
                remainingPublicTokens == 0 || block.timestamp >= cancelledAt + REFUND_WINDOW,
                "Refunds still open"
            );
        } else {
            require(completed, "Cancel project first");
            projectCancelled = true;
            cancelledAt = block.timestamp;
        }

        isFundingActive = false;

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
