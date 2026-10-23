// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

contract ProjectToken is Initializable, ERC20Upgradeable, OwnableUpgradeable {
    function initialize(
        string memory name, 
        string memory symbol, 
        uint256 initialSupply, 
        address initialOwner
    ) public initializer {
        __ERC20_init(name, symbol);
        __Ownable_init(initialOwner);
        _mint(initialOwner, initialSupply * 10 ** decimals());
    }

    function burn(uint256 amount) external {
        _burn(_msgSender(), amount);
    }
}