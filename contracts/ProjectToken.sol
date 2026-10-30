// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

contract ProjectToken is Initializable, ERC20Upgradeable, ERC20PermitUpgradeable, OwnableUpgradeable {
    bool public isInvalidated;

    event TokenInvalidated();

    constructor() {
        _disableInitializers();
    }

    function initialize(
        string memory name, 
        string memory symbol, 
        uint256 initialSupply, 
        address initialOwner
    ) public initializer {
        __ERC20_init(name, symbol);
        __ERC20Permit_init(name);
        __Ownable_init(initialOwner);
        _mint(initialOwner, initialSupply * 10 ** decimals());
        isInvalidated = false;
    }

    modifier checkValidity() {
        require(!isInvalidated, "Token is dead (Emergency Shutdown)");
        _;
    }

    function transfer(address to, uint256 amount) public virtual override checkValidity returns (bool) {
        return super.transfer(to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) public virtual override checkValidity returns (bool) {
        return super.transferFrom(from, to, amount);
    }

    function approve(address spender, uint256 amount) public virtual override checkValidity returns (bool) {
        return super.approve(spender, amount);
    }

    /// @dev ERC-2612 approvals are blocked after emergency invalidation, like approve().
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public virtual override checkValidity {
        super.permit(owner, spender, value, deadline, v, r, s);
    }

    /// @dev Owner (the escrow) only, so holders cannot burn tokens out of the refund accounting.
    function burn(uint256 amount) external onlyOwner {
        _burn(_msgSender(), amount);
    }

    function emergencyInvalidate() external onlyOwner {
        isInvalidated = true;
        emit TokenInvalidated();
    }
}
