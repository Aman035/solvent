// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Context } from "@1inch/swap-vm/src/libs/VM.sol";
import { Opcode, OpcodeOps } from "@1inch/swap-vm/src/libs/OpcodeList.sol";
import { AquaOpcodes } from "@1inch/swap-vm/src/opcodes/AquaOpcodes.sol";

import { ReputationGate } from "../instructions/ReputationGate.sol";
import { ReputationPriceAdjuster } from "../instructions/ReputationPriceAdjuster.sol";

/// @notice The official Aqua opcode set plus two Proof-of-Fill instructions.
///
/// @dev This follows upstream's OWN extension pattern verbatim — see
///      `1inch/swap-vm src/opcodes/AquaOpcodesDebug.sol`, which extends `AquaOpcodes`
///      by overriding `_runOpcode` and falling through to `super`. Nothing inherited is
///      altered, removed or reordered; both new instructions occupy slots that are
///      reserved placeholders (`_21`, `_b3`) in upstream's banked opcode space, so every
///      official opcode index is untouched and a stock program runs byte-identically.
contract ProofOfFillOpcodes is AquaOpcodes {
    using OpcodeOps for Opcode;

    /// @notice Number of Proof-of-Fill instructions appended to the official set.
    uint256 public constant PROOF_OF_FILL_OPCODE_COUNT = 2;

    function _runOpcode(Context memory ctx, uint256 opcode, bytes calldata args) internal override {
        if (opcode == ReputationGate.opcode.asU8()) {
            ReputationGate.exec(ctx, args);
        } else if (opcode == ReputationPriceAdjuster.opcode.asU8()) {
            ReputationPriceAdjuster.exec(ctx, args);
        } else {
            super._runOpcode(ctx, opcode, args);
        }
    }
}
