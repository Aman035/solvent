// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Simulator } from "@1inch/solidity-utils/contracts/mixins/Simulator.sol";

import { Context } from "@1inch/swap-vm/src/libs/VM.sol";
import { SwapVM } from "@1inch/swap-vm/src/SwapVM.sol";

import { ProofOfFillOpcodes } from "../opcodes/ProofOfFillOpcodes.sol";

/// @title ProofOfFillSwapVMRouter
/// @notice The official `AquaSwapVMRouter`, with the Proof-of-Fill instructions appended.
/// @dev Structurally identical to upstream's `AquaSwapVMRouter` and
///      `AquaSwapVMRouterDebug`; only the opcode mixin differs. This is the
///      "redeployment of a modified SwapVM" the 1inch bounty permits.
///
/// Powered by SwapVM — © Degensoft Ltd. See LICENSES/.
contract ProofOfFillSwapVMRouter is Simulator, SwapVM, ProofOfFillOpcodes {
    constructor(
        address aqua,
        address weth,
        address owner,
        string memory name,
        string memory version
    )
        SwapVM(aqua, weth, owner, name, version)
    { }

    function _dispatch(Context memory ctx, uint256 opcode, bytes calldata args) internal override {
        _runOpcode(ctx, opcode, args);
    }
}
