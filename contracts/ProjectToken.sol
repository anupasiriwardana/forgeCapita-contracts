// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ProjectToken
 * @dev A dynamic ERC-20 token representing fractional equity or yield claims 
 * for a specific startup launching on ForgeCapita.
 */
contract ProjectToken is ERC20, Ownable {
    
    /**
     * @dev Constructor mints the entire supply to the initial owner.
     * In the ForgeCapita ecosystem, the `initialOwner` will temporarily be the 
     * Milestone Escrow contract, which will distribute tokens to investors.
     * 
     * @param name The name of the startup's token (e.g., "Acme SaaS Equity")
     * @param symbol The ticker symbol (e.g., "ACME")
     * @param initialSupply Total amount of tokens to ever exist (in full units, decimals handled automatically)
     * @param initialOwner The address that receives the minted supply (The Escrow/Factory)
     */
    constructor(
        string memory name, 
        string memory symbol, 
        uint256 initialSupply, 
        address initialOwner
    ) ERC20(name, symbol) Ownable(initialOwner) {
        // Mint the total supply to the initial owner. 
        // 18 decimals is standard for ERC20.
        _mint(initialOwner, initialSupply * 10 ** decimals());
    }

    /**
     * @dev A fail-safe burn mechanism. 
     * Investors can destroy their own tokens if required by future regulatory logic 
     * or token migration events.
     */
    function burn(uint256 amount) external {
        _burn(_msgSender(), amount);
    }
}
