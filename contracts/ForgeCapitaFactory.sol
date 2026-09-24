// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./ProjectToken.sol";
import "./MilestoneEscrow.sol";
import "./DividendDistributor.sol";
import "./RevenueRouter.sol";

/**
 * @title ForgeCapitaFactory
 * @dev The master deployment engine for the ForgeCapita ecosystem.
 * Automatically spins up and links the Token, Escrow, Distributor, and Router for new startups.
 */
contract ForgeCapitaFactory {
    // Event emitted for the frontend indexer to catch new project launches
    event ProjectLaunched(
        address indexed developer,
        address projectToken,
        address milestoneEscrow,
        address dividendDistributor,
        address revenueRouter
    );

    // Registry to easily query projects built on the platform
    mapping(address => address[]) public developerProjects;
    address[] public allProjects;

    /**
     * @dev Deploys the entire micro-economy for a new SaaS project in a single transaction.
     * @param _name The name of the project token (e.g., "ForgeCapita Equity")
     * @param _symbol The ticker symbol (e.g., "FRGC")
     * @param _totalSupply The fixed amount of tokens to mint
     */
    function launchProject(
        string memory _name,
        string memory _symbol,
        uint256 _totalSupply,
        string[] memory _milestoneDescriptions,
        uint256[] memory _milestonePercentages
    ) external returns (address, address, address, address) {
        // 1. Deploy the Project Token
        // The Factory temporarily assigns itself as the owner to receive the minted supply.
        ProjectToken token = new ProjectToken(
            _name,
            _symbol,
            _totalSupply,
            address(this)
        );

        // 2. Deploy the Milestone Escrow
        // We pass the new token address and the developer's wallet address.
        MilestoneEscrow escrow = new MilestoneEscrow(
            address(token),
            payable(msg.sender),
            _totalSupply,
            _milestoneDescriptions,
            _milestonePercentages
        );

        // 3. Fund the Escrow
        // The Factory transfers 100% of the minted token supply into the locked Escrow vault.
        token.transfer(address(escrow), _totalSupply * 10 ** token.decimals());

        // 4. Deploy the Dividend Distributor
        // It only needs to know which token it is distributing yield for.
        DividendDistributor distributor = new DividendDistributor(
            address(token)
        );

        // 5. Deploy the Revenue Router
        // (Note: Your RevenueRouter constructor will need to be updated to accept the distributor address
        // so it knows where to send the 20% dividend cut).
        RevenueRouter router = new RevenueRouter(
            payable(msg.sender),
            payable(address(distributor))
        );

        // 6. Record the deployment in the ForgeCapita Registry
        developerProjects[msg.sender].push(address(token));
        allProjects.push(address(token));

        // 7. Broadcast the ecosystem addresses to the Indexer
        emit ProjectLaunched(
            msg.sender,
            address(token),
            address(escrow),
            address(distributor),
            address(router)
        );

        return (
            address(token),
            address(escrow),
            address(distributor),
            address(router)
        );
    }

    /**
     * @dev Helper function for the frontend to count total platform launches.
     */
    function getTotalProjects() external view returns (uint256) {
        return allProjects.length;
    }
}
