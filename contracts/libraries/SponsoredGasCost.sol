// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IForgeCapitaRegistry.sol";

/// @notice Cost model for a relayer-sponsored action (design section 5). Internal only, inlined by callers.
/// The cost is measured at the END of the call (claim, vote, stake) so it covers the whole body, plus a
/// fixed per-action overhead for the work that cannot be measured from inside the call: the dispatcher and
/// reentrancy-guard entry before `gasAtEntry`, the booking itself and the exit after the measurement.
/// Each overhead is a conservative lower bound of that work, so booked gas stays at or below the gas
/// actually paid; test/GasMeasurement.ts fails when a code change moves the gap outside the tolerance.
library SponsoredGasCost {
    uint256 private constant BASE_TX_GAS = 21000;
    uint256 private constant GAS_PER_CALLDATA_BYTE = 16;

    /// Unmeasured work after `gasAtEntry`/before the end-of-call reading, per action (lower bounds).
    uint256 internal constant CLAIM_OVERHEAD = 19500;
    uint256 internal constant STAKE_OVERHEAD = 2700;
    uint256 internal constant VOTE_OVERHEAD = 19000;
    /// executeMilestone is measured before its payouts; the payout work is covered by these constants.
    uint256 internal constant EXECUTE_OVERHEAD = 62000;
    /// Added when the executed milestone is the final one (vests developer tokens, emits ProjectCompleted).
    uint256 internal constant EXECUTE_FINAL_EXTRA = 40000;

    /// @param gasAtEntry `gasleft()` read on entry to the sponsored function.
    /// @param dataLength `msg.data.length` of the sponsored call.
    /// @param overhead fixed unmeasured gas for this action (one of the constants above).
    function cost(
        IForgeCapitaRegistry registry,
        uint8 action,
        uint256 gasAtEntry,
        uint256 dataLength,
        uint256 overhead
    ) internal view returns (uint256) {
        uint256 used = gasAtEntry - gasleft() + overhead + BASE_TX_GAS + GAS_PER_CALLDATA_BYTE * dataLength;
        uint256 total = used * tx.gasprice + registry.l1Surcharge(action);
        uint256 cap = registry.maxCostPerAction();
        return total < cap ? total : cap;
    }
}
