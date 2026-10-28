// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IDistributorTarget {
    function stake(uint256 amount) external;
    function withdraw(uint256 amount) external;
    function claimYield() external;
}

/// @dev Test-only staker. When it receives ETH it re-enters the distributor with the configured
/// action and records the revert data (if any) instead of reverting, so the outer call still completes.
contract MockReentrantStaker {
    enum Action { None, ClaimYield, Withdraw, Stake }

    IDistributorTarget public immutable distributor;
    IERC20 public immutable token;
    Action public action;
    bool public reentered;
    bool public reentrySucceeded;
    bytes public reentryRevertData;

    constructor(address _distributor, address _token) {
        distributor = IDistributorTarget(_distributor);
        token = IERC20(_token);
    }

    function setAction(Action _action) external {
        action = _action;
    }

    function stakeAll() external {
        uint256 balance = token.balanceOf(address(this));
        token.approve(address(distributor), balance);
        distributor.stake(balance);
    }

    function claim() external {
        distributor.claimYield();
    }

    function withdrawAmount(uint256 amount) external {
        distributor.withdraw(amount);
    }

    receive() external payable {
        if (action == Action.None) return;
        reentered = true;
        bool ok;
        bytes memory data;
        if (action == Action.ClaimYield) {
            (ok, data) = address(distributor).call(abi.encodeCall(IDistributorTarget.claimYield, ()));
        } else if (action == Action.Withdraw) {
            (ok, data) = address(distributor).call(abi.encodeCall(IDistributorTarget.withdraw, (1)));
        } else {
            (ok, data) = address(distributor).call(abi.encodeCall(IDistributorTarget.stake, (1)));
        }
        reentrySucceeded = ok;
        reentryRevertData = data;
    }
}
