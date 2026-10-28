// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IForgeCapitaRegistry.sol";

/// @notice Cost model for a relayer-sponsored action (design section 5). Internal only, inlined by callers.
library SponsoredGasCost {
    uint256 private constant BASE_TX_GAS = 21000;
    uint256 private constant GAS_PER_CALLDATA_BYTE = 16;

    /// @param gasAtEntry `gasleft()` read on entry to the sponsored function.
    /// @param dataLength `msg.data.length` of the sponsored call.
    function cost(
        IForgeCapitaRegistry registry,
        uint8 action,
        uint256 gasAtEntry,
        uint256 dataLength
    ) internal view returns (uint256) {
        uint256 used = gasAtEntry - gasleft() + BASE_TX_GAS + GAS_PER_CALLDATA_BYTE * dataLength;
        uint256 total = used * tx.gasprice + registry.l1Surcharge(action);
        uint256 cap = registry.maxCostPerAction();
        return total < cap ? total : cap;
    }
}
