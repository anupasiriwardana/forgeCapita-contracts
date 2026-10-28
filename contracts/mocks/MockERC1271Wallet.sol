// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

interface IVoteTarget {
    function vote(bool support) external;
}

/// @dev Test-only smart wallet: ERC-1271 signatures are valid when signed by `owner`.
/// With `reenter` set, validation first tries to call back into `target.vote(true)`
/// and only approves the signature if that call succeeds.
contract MockERC1271Wallet {
    bytes4 private constant MAGIC = 0x1626ba7e;

    address public immutable owner;
    address public target;
    bool public reenter;

    constructor(address _owner) {
        owner = _owner;
    }

    function configureReentry(address _target, bool _reenter) external {
        require(msg.sender == owner, "owner only");
        target = _target;
        reenter = _reenter;
    }

    function execute(address to, bytes calldata data) external returns (bytes memory) {
        require(msg.sender == owner, "owner only");
        (bool ok, bytes memory ret) = to.call(data);
        require(ok, "call failed");
        return ret;
    }

    function isValidSignature(bytes32 hash, bytes calldata signature) external returns (bytes4) {
        if (reenter) {
            IVoteTarget(target).vote(true);
        }
        (address signer, ECDSA.RecoverError err, ) = ECDSA.tryRecover(hash, signature);
        return (err == ECDSA.RecoverError.NoError && signer == owner) ? MAGIC : bytes4(0xffffffff);
    }
}
