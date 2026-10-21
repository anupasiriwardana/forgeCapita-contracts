// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IDividendDistributor {
    function stakedBalance(address account) external view returns (uint256);
    function totalStaked() external view returns (uint256);
}
