// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { MakerTraitsLib } from "@1inch/swap-vm/src/libs/MakerTraits.sol";
import { TakerTraitsLib } from "@1inch/swap-vm/src/libs/TakerTraits.sol";

/// @notice Read-only encoder so the TypeScript agents can build SwapVM orders and taker
///         data using the OFFICIAL libraries, rather than reimplementing the bit-packing.
///
/// @dev MakerTraitsLib.build / TakerTraitsLib.build are internal pure, so they cannot be
///      called from off-chain directly. Exposing them through external pure functions
///      means the agents and the contracts can never disagree about an encoding - and it
///      keeps a whole class of bug (a hand-rolled traits packer drifting from upstream)
///      out of the project entirely.
contract ProofOfFillHelper {
    function buildOrder(MakerTraitsLib.Args calldata args) external pure returns (ISwapVM.Order memory) {
        return MakerTraitsLib.build(args);
    }

    function buildTakerData(TakerTraitsLib.Args calldata args) external pure returns (bytes memory) {
        return TakerTraitsLib.build(args);
    }
}
