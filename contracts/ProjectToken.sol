// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ProjectToken
 * @dev Upgraded with ERC20Votes to prevent Flash-Vote Sybil exploits.
 */
contract ProjectToken is ERC20, ERC20Permit, ERC20Votes, Ownable {
    
    constructor(
        string memory name, 
        string memory symbol, 
        uint256 initialSupply, 
        address initialOwner
    ) ERC20(name, symbol) ERC20Permit(name) Ownable(initialOwner) {
        _mint(initialOwner, initialSupply * 10 ** decimals());
    }

    function burn(uint256 amount) external {
        _burn(_msgSender(), amount);
    }

    // Required overrides by Solidity for ERC20Votes in OpenZeppelin v5
    function _update(address from, address to, uint256 value) internal override(ERC20, ERC20Votes) {
        super._update(from, to, value);
    }

    function nonces(address owner) public view override(ERC20Permit, Nonces) returns (uint256) {
        return super.nonces(owner);
    }
}