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

import { ISolventBook } from "../interfaces/ISolventBook.sol";

/// @notice SolvencyFloor opcode: a maker's covenant to stop quoting before it is
///         over-extended, enforced inside the swap itself.
///
/// @dev Encoding: [address book][uint32 maxUtilisationBps]
///
/// @dev The Aqua whitepaper recommends makers "manually dock strategies that become
///      chronically underfunded". This is that pause, automatic: when the maker's
///      aggregate utilisation for the token being promised (ctx.query.tokenOut) rises
///      above the maker-chosen ceiling, the strategy DECLINES AT QUOTE TIME instead of
///      keeping a stale quote alive and failing at settlement in a taker's face.
///
/// @dev Occupies Opcode._22, the next free slot in the conditions and access guards
///      bank. Validation-only: no register writes, no runLoop, safe under staticcall,
///      prefix-safe. Any taker can read this covenant out of the program bytes before
///      trading.
library SolvencyFloor {
    using InstructionArgs for bytes;
    using InstructionArgs for bytes32;

    using MemoryPtrLib for MemoryPtr;
    using InstructionBuilder for MemoryPtr;

    error MakerBeyondSolvencyFloor(address maker, address token, uint32 utilisationBps, uint32 maxUtilisationBps);

    Opcode internal constant opcode = Opcode._22;

    function sizeOf() internal pure returns (uint256) {
        return InstructionBuilder.sizeOf() + 20 + 4;
    }

    function build(address book, uint32 maxUtilisationBps) internal pure returns (bytes memory) {
        return build(MemoryPtrLib.alloc(sizeOf()), book, maxUtilisationBps).resolve();
    }

    function build(MemoryPtr ptrStart, address book, uint32 maxUtilisationBps) internal pure returns (MemoryPtr ptr) {
        ptr = ptrStart.pushHeader(opcode);
        ptr = ptr.push(book).push(uint256(maxUtilisationBps), 4);
        ptrStart.patchLength(ptr);
    }

    function parse(bytes calldata args) internal pure returns (address book, uint32 maxUtilisationBps) {
        book = args.at(0).asAddress();
        maxUtilisationBps = args.at(20).asU32();
    }

    function exec(Context memory ctx, bytes calldata args) internal view {
        (address book, uint32 maxBps) = parse(args);
        uint32 u = ISolventBook(book).utilisationBps(ctx.query.maker, ctx.query.tokenOut);
        require(u <= maxBps, MakerBeyondSolvencyFloor(ctx.query.maker, ctx.query.tokenOut, u, maxBps));
    }
}
