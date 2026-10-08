// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract P2PExchange is ReentrancyGuard {
    address payable public immutable treasury;
    uint256 public constant PROTOCOL_FEE_BPS = 100; // 1% fee (100 / 10,000)

    struct Listing {
        address seller;
        address tokenAddress;
        uint256 tokenAmount;
        uint256 priceInETH;
        bool active;
    }

    uint256 public nextListingId;
    mapping(uint256 => Listing) public listings;

    event ListingCreated(uint256 indexed listingId, address indexed seller, address indexed token, uint256 amount, uint256 price);
    event ListingFilled(uint256 indexed listingId, address indexed buyer, address indexed seller, uint256 price);
    event ListingCancelled(uint256 indexed listingId, address indexed seller);

    constructor(address payable _treasury) {
        treasury = _treasury;
    }

    function createListing(address tokenAddress, uint256 tokenAmount, uint256 priceInETH) external nonReentrant returns (uint256) {
        require(tokenAmount > 0, "Amount must be > 0");
        require(priceInETH > 0, "Price must be > 0");

        require(IERC20(tokenAddress).transferFrom(msg.sender, address(this), tokenAmount), "Token transfer failed");

        uint256 listingId = nextListingId++;
        listings[listingId] = Listing({
            seller: msg.sender,
            tokenAddress: tokenAddress,
            tokenAmount: tokenAmount,
            priceInETH: priceInETH,
            active: true
        });

        emit ListingCreated(listingId, msg.sender, tokenAddress, tokenAmount, priceInETH);
        return listingId;
    }

    function fillListing(uint256 listingId) external payable nonReentrant {
        Listing storage item = listings[listingId];
        require(item.active, "Listing is not active");
        require(msg.value == item.priceInETH, "Incorrect ETH amount sent");

        item.active = false;

        uint256 fee = (msg.value * PROTOCOL_FEE_BPS) / 10000;
        uint256 sellerProceeds = msg.value - fee;

        (bool feeSuccess, ) = treasury.call{value: fee}("");
        require(feeSuccess, "Treasury transfer failed");

        (bool sellerSuccess, ) = payable(item.seller).call{value: sellerProceeds}("");
        require(sellerSuccess, "Seller transfer failed");

        require(IERC20(item.tokenAddress).transfer(msg.sender, item.tokenAmount), "Token transfer to buyer failed");

        emit ListingFilled(listingId, msg.sender, item.seller, msg.value);
    }

    function cancelListing(uint256 listingId) external nonReentrant {
        Listing storage item = listings[listingId];
        require(item.active, "Listing is not active");
        require(item.seller == msg.sender, "Only seller can cancel");

        item.active = false;
        require(IERC20(item.tokenAddress).transfer(msg.sender, item.tokenAmount), "Token return failed");

        emit ListingCancelled(listingId, msg.sender);
    }
}