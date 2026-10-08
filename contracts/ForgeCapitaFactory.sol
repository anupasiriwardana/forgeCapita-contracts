// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./ProjectToken.sol";
import "./MilestoneEscrow.sol";
import "./DividendDistributor.sol";
import "./RevenueRouter.sol";

contract ForgeCapitaFactory {
    
    address payable public immutable forgeCapitaTreasury;

    event ProjectLaunched(
        address indexed developer,
        address projectToken,
        address milestoneEscrow,
        address dividendDistributor,
        address revenueRouter
    );

    mapping(address => address[]) public developerProjects;
    address[] public allProjects;

    // Factory is initialized with the platform's treasury wallet
    constructor(address payable _treasury) {
        forgeCapitaTreasury = _treasury;
    }

    function launchProject(
        string memory _name,
        string memory _symbol,
        uint256 _totalSupply,
        string[] memory _milestoneDescriptions,
        uint256[] memory _milestonePercentages,
        uint256 _fundingGoal,
        uint256 _fundingDurationDays
    ) external returns (address, address, address, address) {
        
        ProjectToken token = new ProjectToken(_name, _symbol, _totalSupply, address(this));
        uint256 scaledSupply = _totalSupply * 10 ** token.decimals();
        
        MilestoneEscrow escrow = new MilestoneEscrow(
            address(token), 
            payable(msg.sender), 
            scaledSupply, 
            _milestoneDescriptions, 
            _milestonePercentages,
            _fundingGoal,
            _fundingDurationDays,
            forgeCapitaTreasury // Pass treasury down
        );
        
        token.transfer(address(escrow), scaledSupply);
        
        DividendDistributor distributor = new DividendDistributor(address(token));
        
        RevenueRouter router = new RevenueRouter(
            payable(msg.sender), 
            payable(address(distributor)),
            forgeCapitaTreasury // Pass treasury down
        );
        
        developerProjects[msg.sender].push(address(token));
        allProjects.push(address(token));
        
        emit ProjectLaunched(
            msg.sender, address(token), address(escrow), address(distributor), address(router)
        );
        
        return (address(token), address(escrow), address(distributor), address(router));
    }

    function getTotalProjects() external view returns (uint256) {
        return allProjects.length;
    }
}