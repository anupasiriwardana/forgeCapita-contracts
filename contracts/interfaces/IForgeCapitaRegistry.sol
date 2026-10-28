// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IForgeCapitaRegistry {
    function treasury() external view returns (address payable);
    function guardian() external view returns (address);
    function isRelayer(address account) external view returns (bool);
    function maxCostPerAction() external view returns (uint256);
    function l1Surcharge(uint8 action) external view returns (uint256);
}
