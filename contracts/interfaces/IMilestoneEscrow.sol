// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IMilestoneEscrow {
    function developer() external view returns (address payable);
    function isUserVoteLocked(address account) external view returns (bool);
}
