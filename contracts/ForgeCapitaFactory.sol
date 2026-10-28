// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "./ProjectToken.sol";
import "./MilestoneEscrow.sol";
import "./DividendDistributor.sol";
import "./RevenueRouter.sol";
import "./P2PExchange.sol";
import "./interfaces/IForgeCapitaRegistry.sol";

contract ForgeCapitaFactory {
    address public immutable masterToken;
    address public immutable masterEscrow;
    address public immutable masterDistributor;
    address public immutable masterRouter;
    
    IForgeCapitaRegistry public immutable registry;
    P2PExchange public immutable p2pExchange;

    mapping(address => address[]) public developerProjects;
    address[] public allProjects;

    event ProjectLaunched(
        address indexed developer,
        address projectToken,
        address milestoneEscrow,
        address dividendDistributor,
        address revenueRouter
    );

    constructor(
        address _masterToken,
        address _masterEscrow,
        address _masterDistributor,
        address _masterRouter,
        address _registry
    ) {
        masterToken = _masterToken;
        masterEscrow = _masterEscrow;
        masterDistributor = _masterDistributor;
        masterRouter = _masterRouter;
        registry = IForgeCapitaRegistry(_registry);
        p2pExchange = new P2PExchange(_registry);
    }

    /// @notice Fee recipient, read from the registry so it follows treasury rotation.
    function forgeCapitaTreasury() external view returns (address payable) {
        return registry.treasury();
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
        // 1. Clone & Initialize Token
        address tokenClone = Clones.clone(masterToken);
        ProjectToken(tokenClone).initialize(_name, _symbol, _totalSupply, address(this));
        
        // 2. Clone & Initialize Distributor
        address distributorClone = Clones.clone(masterDistributor);
        DividendDistributor(payable(distributorClone)).initialize(tokenClone, address(this), address(registry));
        
        // 3. Clone & Initialize Escrow
        address escrowClone = Clones.clone(masterEscrow);
        uint256 scaledSupply = _totalSupply * 10 ** ProjectToken(tokenClone).decimals();
        MilestoneEscrow(payable(escrowClone)).initialize(
            tokenClone,
            payable(msg.sender),
            scaledSupply,
            _milestoneDescriptions,
            _milestonePercentages,
            _fundingGoal,
            _fundingDurationDays,
            address(registry),
            distributorClone
        );

        // 4. Clone & Initialize Router
        address routerClone = Clones.clone(masterRouter);
        RevenueRouter(payable(routerClone)).initialize(
            escrowClone,
            payable(distributorClone),
            address(registry)
        );

        // Wire contracts together
        DividendDistributor(payable(distributorClone)).setMilestoneEscrow(escrowClone);
        require(ProjectToken(tokenClone).transfer(escrowClone, scaledSupply), "Token transfer failed");

        ProjectToken(tokenClone).transferOwnership(escrowClone);
        developerProjects[msg.sender].push(tokenClone);
        allProjects.push(tokenClone);

        emit ProjectLaunched(msg.sender, tokenClone, escrowClone, distributorClone, routerClone);
        
        return (tokenClone, escrowClone, distributorClone, routerClone);
    }

    function getTotalProjects() external view returns (uint256) {
        return allProjects.length;
    }
}
