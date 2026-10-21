// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ProjectToken
 * @dev Lightweight ERC-20 equity token for startups launching on ForgeCapita.
 */
contract ProjectToken is ERC20, Ownable {
    constructor(
        string memory name, 
        string memory symbol, 
        uint256 initialSupply, 
        address initialOwner
    ) ERC20(name, symbol) Ownable(initialOwner) {
        _mint(initialOwner, initialSupply * 10 ** decimals());
    }

    function burn(uint256 amount) external {
        _burn(_msgSender(), amount);
    }
}