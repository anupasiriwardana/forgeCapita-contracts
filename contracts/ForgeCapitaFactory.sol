// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "./ProjectToken.sol";
import "./MilestoneEscrow.sol";
import "./DividendDistributor.sol";
import "./RevenueRouter.sol";
import "./P2PExchange.sol";

contract ForgeCapitaFactory {
    address public immutable masterToken;
    address public immutable masterEscrow;
    address public immutable masterDistributor;
    address public immutable masterRouter;
    
    address payable public immutable forgeCapitaTreasury;
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
        address payable _treasury
    ) {
        masterToken = _masterToken;
        masterEscrow = _masterEscrow;
        masterDistributor = _masterDistributor;
        masterRouter = _masterRouter;
        forgeCapitaTreasury = _treasury;
        p2pExchange = new P2PExchange(_treasury);
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
        DividendDistributor(payable(distributorClone)).initialize(tokenClone, address(this));
        
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
            forgeCapitaTreasury,
            distributorClone
        );

        // 4. Clone & Initialize Router
        address routerClone = Clones.clone(masterRouter);
        RevenueRouter(payable(routerClone)).initialize(
            escrowClone,
            payable(distributorClone),
            forgeCapitaTreasury
        );

        // Wire contracts together
        DividendDistributor(payable(distributorClone)).setMilestoneEscrow(escrowClone);
        ProjectToken(tokenClone).transfer(escrowClone, scaledSupply);

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
