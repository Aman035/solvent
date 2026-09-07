// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
// This file extends the SwapVM runtime and is therefore licensed under the same terms
// as the Licensed Work it modifies (SwapVM-1.1 section 3.1). Licence text: LICENSES/.
// Powered by SwapVM, (c) Degensoft Ltd 2025.
pragma solidity 0.8.30;

import { Simulator } from "@1inch/solidity-utils/contracts/mixins/Simulator.sol";

import { Context } from "@1inch/swap-vm/src/libs/VM.sol";
import { SwapVM } from "@1inch/swap-vm/src/SwapVM.sol";

import { SolventOpcodes } from "../opcodes/SolventOpcodes.sol";

/// @title SolventRouter
/// @notice The official AquaSwapVMRouter shape carrying Solvent's instruction set.
contract SolventRouter is Simulator, SwapVM, SolventOpcodes {
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
