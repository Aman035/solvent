// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
// This file extends the SwapVM runtime and is therefore licensed under the same terms
// as the Licensed Work it modifies (SwapVM-1.1 section 3.1). Licence text: LICENSES/.
// Powered by SwapVM, (c) Degensoft Ltd 2025.
pragma solidity 0.8.30;

import { Context } from "@1inch/swap-vm/src/libs/VM.sol";
import { Opcode } from "@1inch/swap-vm/src/libs/OpcodeList.sol";
import { MemoryPtr, MemoryPtrLib } from "@1inch/swap-vm/src/libs/MemoryPtr.sol";
import { InstructionBuilder } from "@1inch/swap-vm/src/libs/InstructionBuilder.sol";
import { InstructionArgs } from "@1inch/swap-vm/src/libs/InstructionArgs.sol";

import { ISolventScore } from "../interfaces/ISolventScore.sol";

/// @notice ReputationGate opcode — refuse takers whose Proof-of-Fill score is below a floor.
///
/// @dev Encoding: [address scoreOracle][uint32 floor]
///
/// @dev Occupies `Opcode._21`, the first free slot in the **conditions & access guards**
///      bank (0x20-0x3f), per upstream's convention in `OpcodeList.sol`:
///      "For new instructions take the next free `_Ix` slots of their family bank."
///      Because every unallocated index is already a named placeholder upstream, adding
///      this instruction cannot renumber any official opcode.
///
/// @dev Validation-only: it reads no taker args, mutates no swap registers and does not
///      call `ctx.runLoop()`. That makes it prefix-safe in the sense of upstream's
///      `Strategies._prefixBitmap`, and safe to execute in a `staticcall` quote context —
///      so a maker's refusal is visible at QUOTE time, not only at swap time.
///
/// @dev Taker identity is `ctx.query.taker`, which `SwapVM` sets to `msg.sender` in both
///      `quote()` and `swap()`. A taker therefore cannot spoof the address being scored.
///      Corollary: a taker routing through an aggregator is scored as that contract —
///      see docs/TRUST_ASSUMPTIONS.md.
library ReputationGate {
    using InstructionArgs for bytes;
    using InstructionArgs for bytes32;

    using MemoryPtrLib for MemoryPtr;
    using InstructionBuilder for MemoryPtr;

    /// @notice Thrown when the taker's Proof-of-Fill score is below the maker's floor.
    error TakerBelowReputationFloor(address taker, uint32 score, uint32 floor);

    Opcode internal constant opcode = Opcode._21;

    function sizeOf() internal pure returns (uint256) {
        return InstructionBuilder.sizeOf() + 20 + 4;
    }

    function build(address scoreOracle, uint32 floor) internal pure returns (bytes memory) {
        return build(MemoryPtrLib.alloc(sizeOf()), scoreOracle, floor).resolve();
    }

    function build(MemoryPtr ptrStart, address scoreOracle, uint32 floor) internal pure returns (MemoryPtr ptr) {
        ptr = ptrStart.pushHeader(opcode);
        ptr = ptr.push(scoreOracle).push(uint256(floor), 4);
        ptrStart.patchLength(ptr);
    }

    function parse(bytes calldata args) internal pure returns (address scoreOracle, uint32 floor) {
        scoreOracle = args.at(0).asAddress();
        floor = args.at(20).asU32();
    }

    function exec(Context memory ctx, bytes calldata args) internal view {
        (address scoreOracle, uint32 floor) = parse(args);
        uint32 score = ISolventScore(scoreOracle).scoreOf(ctx.query.taker);
        require(score >= floor, TakerBelowReputationFloor(ctx.query.taker, score, floor));
    }
}
