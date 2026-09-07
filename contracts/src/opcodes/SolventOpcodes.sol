// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
// This file extends the SwapVM runtime and is therefore licensed under the same terms
// as the Licensed Work it modifies (SwapVM-1.1 section 3.1). Licence text: LICENSES/.
// Powered by SwapVM, (c) Degensoft Ltd 2025.
pragma solidity 0.8.30;

import { Context } from "@1inch/swap-vm/src/libs/VM.sol";
import { Opcode, OpcodeOps } from "@1inch/swap-vm/src/libs/OpcodeList.sol";
import { AquaOpcodes } from "@1inch/swap-vm/src/opcodes/AquaOpcodes.sol";

import { ReputationGate } from "../instructions/ReputationGate.sol";
import { ReputationPriceAdjuster } from "../instructions/ReputationPriceAdjuster.sol";
import { SolvencyFloor } from "../instructions/SolvencyFloor.sol";
import { SolvencySkew } from "../instructions/SolvencySkew.sol";

/// @notice The official Aqua opcode set plus Solvent's four instructions: the solvency
///         covenant pair (floor, skew) and the settlement-record pair (gate, adjuster).
///         Upstream's own extension pattern; every added instruction occupies a
///         reserved placeholder slot, so no official opcode index moves.
contract SolventOpcodes is AquaOpcodes {
    using OpcodeOps for Opcode;

    uint256 public constant SOLVENT_OPCODE_COUNT = 4;

    function _runOpcode(Context memory ctx, uint256 opcode, bytes calldata args) internal override {
        if (opcode == SolvencyFloor.opcode.asU8()) {
            SolvencyFloor.exec(ctx, args);
        } else if (opcode == SolvencySkew.opcode.asU8()) {
            SolvencySkew.exec(ctx, args);
        } else if (opcode == ReputationGate.opcode.asU8()) {
            ReputationGate.exec(ctx, args);
        } else if (opcode == ReputationPriceAdjuster.opcode.asU8()) {
            ReputationPriceAdjuster.exec(ctx, args);
        } else {
            super._runOpcode(ctx, opcode, args);
        }
    }
}
