// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IForgeCapitaRegistry.sol";

/**
 * @title ForgeCapitaRegistry
 * @notice One per deployment. Holds the protocol roles and sponsorship parameters
 * that every escrow, distributor, router, P2P exchange and the factory read at call time.
 * Treasury and guardian rotate in two steps (propose, then accept by the new address).
 */
contract ForgeCapitaRegistry is IForgeCapitaRegistry {
    /// @dev Sponsored action kinds: Claim, Stake, Vote, Execute.
    uint8 public constant ACTION_COUNT = 4;
    uint256 public constant MAX_COST_PER_ACTION_LIMIT = 1 ether;
    uint256 public constant MAX_L1_SURCHARGE_LIMIT = 1 ether;

    address payable public treasury;
    address public guardian;
    address payable public pendingTreasury;
    address public pendingGuardian;

    uint256 public maxCostPerAction;
    mapping(address => bool) public isRelayer;
    mapping(uint8 => uint256) private _l1Surcharge;

    error ZeroAddress();
    error NotTreasury();
    error NotGuardian();
    error NotPendingTreasury();
    error NotPendingGuardian();
    error InvalidAction();
    error ValueAboveLimit();

    event RelayerSet(address indexed relayer, bool allowed);
    event TreasuryProposed(address indexed currentTreasury, address indexed proposed);
    event TreasuryChanged(address indexed oldTreasury, address indexed newTreasury);
    event GuardianProposed(address indexed currentGuardian, address indexed proposed);
    event GuardianChanged(address indexed oldGuardian, address indexed newGuardian);
    event MaxCostPerActionSet(uint256 value);
    event L1SurchargeSet(uint8 indexed action, uint256 value);

    modifier onlyTreasury() {
        if (msg.sender != treasury) revert NotTreasury();
        _;
    }

    modifier onlyGuardian() {
        if (msg.sender != guardian) revert NotGuardian();
        _;
    }

    /// @param admin Initial treasury and guardian (the same wallet at launch).
    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        treasury = payable(admin);
        guardian = admin;
    }

    /// @notice Surcharge added per sponsored action of the given kind (wei).
    function l1Surcharge(uint8 action) external view returns (uint256) {
        if (action >= ACTION_COUNT) revert InvalidAction();
        return _l1Surcharge[action];
    }

    /// @notice Treasury proposes a new treasury. Overwrites any pending proposal.
    function proposeTreasury(address newTreasury) external onlyTreasury {
        if (newTreasury == address(0)) revert ZeroAddress();
        pendingTreasury = payable(newTreasury);
        emit TreasuryProposed(treasury, newTreasury);
    }

    /// @notice The proposed address accepts and becomes the treasury.
    function acceptTreasury() external {
        if (msg.sender != pendingTreasury) revert NotPendingTreasury();
        address oldTreasury = treasury;
        treasury = pendingTreasury;
        pendingTreasury = payable(address(0));
        emit TreasuryChanged(oldTreasury, treasury);
    }

    /// @notice Guardian proposes a new guardian. Overwrites any pending proposal.
    function proposeGuardian(address newGuardian) external onlyGuardian {
        if (newGuardian == address(0)) revert ZeroAddress();
        pendingGuardian = newGuardian;
        emit GuardianProposed(guardian, newGuardian);
    }

    /// @notice The proposed address accepts and becomes the guardian.
    function acceptGuardian() external {
        if (msg.sender != pendingGuardian) revert NotPendingGuardian();
        address oldGuardian = guardian;
        guardian = pendingGuardian;
        pendingGuardian = address(0);
        emit GuardianChanged(oldGuardian, guardian);
    }

    /// @notice Guardian adds or removes a relayer from the allow-list.
    function setRelayer(address relayer, bool allowed) external onlyGuardian {
        if (relayer == address(0)) revert ZeroAddress();
        isRelayer[relayer] = allowed;
        emit RelayerSet(relayer, allowed);
    }

    /// @notice Guardian sets the cap on what one sponsored action may cost a project (wei).
    function setMaxCostPerAction(uint256 value) external onlyGuardian {
        if (value > MAX_COST_PER_ACTION_LIMIT) revert ValueAboveLimit();
        maxCostPerAction = value;
        emit MaxCostPerActionSet(value);
    }

    /// @notice Guardian sets the flat L1 data-fee surcharge for one action kind (wei).
    function setL1Surcharge(uint8 action, uint256 value) external onlyGuardian {
        if (action >= ACTION_COUNT) revert InvalidAction();
        if (value > MAX_L1_SURCHARGE_LIMIT) revert ValueAboveLimit();
        _l1Surcharge[action] = value;
        emit L1SurchargeSet(action, value);
    }
}
