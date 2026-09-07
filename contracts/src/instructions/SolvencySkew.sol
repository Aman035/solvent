// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
// This file extends the SwapVM runtime and is therefore licensed under the same terms
// as the Licensed Work it modifies (SwapVM-1.1 section 3.1). Licence text: LICENSES/.
// Powered by SwapVM, (c) Degensoft Ltd 2025.
pragma solidity 0.8.30;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { Context, ContextLib } from "@1inch/swap-vm/src/libs/VM.sol";
import { Opcode } from "@1inch/swap-vm/src/libs/OpcodeList.sol";
import { MemoryPtr, MemoryPtrLib } from "@1inch/swap-vm/src/libs/MemoryPtr.sol";
import { InstructionBuilder } from "@1inch/swap-vm/src/libs/InstructionBuilder.sol";
import { InstructionArgs } from "@1inch/swap-vm/src/libs/InstructionArgs.sol";

import { ISolventBook } from "../interfaces/ISolventBook.sol";

/// @notice SolvencySkew opcode: quotes that widen as the maker's book thins.
///
/// @dev Encoding: [address book][uint32 startBps][uint24 maxWidenBps]
///      maxWidenBps is denominated in 1e7, the same unit as upstream fee instructions.
///
/// @dev Inventory-aware pricing for a shared balance sheet. Below startBps utilisation
///      the instruction is a provable no-op (plain runLoop, byte-identical quote).
///      Between startBps and full utilisation the widening ramps linearly to
///      maxWidenBps; at or beyond full utilisation (an under-backed book) the full
///      widening applies. The exact-in and exact-out arithmetic mirrors FeeFlatIn
///      branch for branch, so a skewed quote equals a stock program carrying an
///      equivalent flat fee.
///
/// @dev Occupies Opcode._b5, a free slot in the rates tuning bank. It mutates swap
///      registers, so it is a WRAPPER (calls ctx.runLoop) and must precede pricing.
library SolvencySkew {
    using InstructionArgs for bytes;
    using InstructionArgs for bytes32;

    using MemoryPtrLib for MemoryPtr;
    using InstructionBuilder for MemoryPtr;

    using ContextLib for Context;
    using Math for uint256;

    error SkewParamsOutOfRange(uint32 startBps, uint24 maxWidenBps);

    Opcode internal constant opcode = Opcode._b5;

    uint256 internal constant BPS7 = 1e7; // fee denominator, matches upstream
    uint256 internal constant FULL = 10_000; // utilisation denominator

    function sizeOf() internal pure returns (uint256) {
        return InstructionBuilder.sizeOf() + 20 + 4 + 3;
    }

    function build(address book, uint32 startBps, uint24 maxWidenBps) internal pure returns (bytes memory) {
        return build(MemoryPtrLib.alloc(sizeOf()), book, startBps, maxWidenBps).resolve();
    }

    function build(
        MemoryPtr ptrStart,
        address book,
        uint32 startBps,
        uint24 maxWidenBps
    )
        internal
        pure
        returns (MemoryPtr ptr)
    {
        require(startBps < FULL && maxWidenBps < BPS7, SkewParamsOutOfRange(startBps, maxWidenBps));
        ptr = ptrStart.pushHeader(opcode);
        ptr = ptr.push(book).push(uint256(startBps), 4).push(uint256(maxWidenBps), 3);
        ptrStart.patchLength(ptr);
    }

    function parse(bytes calldata args) internal pure returns (address book, uint32 startBps, uint24 maxWidenBps) {
        book = args.at(0).asAddress();
        startBps = args.at(20).asU32();
        maxWidenBps = args.at(24).asU24();
    }

    /// @notice The widening applied at a given utilisation, in the 1e7 fee unit.
    ///         Pure and total, mirrored in TypeScript for the differential tests.
    function widenFor(uint32 utilisationBps, uint32 startBps, uint24 maxWidenBps) internal pure returns (uint256) {
        if (utilisationBps <= startBps) {
            return 0;
        }
        uint256 span = FULL - startBps;
        uint256 over = utilisationBps >= FULL ? span : utilisationBps - startBps;
        return (uint256(maxWidenBps) * over) / span;
    }

    function exec(Context memory ctx, bytes calldata args) internal {
        (address book, uint32 startBps, uint24 maxWidenBps) = parse(args);

        uint32 u = ISolventBook(book).utilisationBps(ctx.query.maker, ctx.query.tokenOut);
        uint256 widen = widenFor(u, startBps, maxWidenBps);
        if (widen == 0) {
            ctx.runLoop(); // healthy book: provably identical to a program without this instruction
            return;
        }

        // FeeFlatIn's exact-in / exact-out branches, with the solvency-derived rate.
        if (ctx.query.isExactIn) {
            uint256 cut = (ctx.swap.amountIn * widen).ceilDiv(BPS7);
            ctx.swap.amountIn -= cut;

            uint256 reduction = ctx.swap.amountIn;
            ctx.runLoop();
            reduction -= ctx.swap.amountIn;

            if (reduction == 0) {
                ctx.swap.amountIn += cut;
            } else {
                ctx.swap.amountIn += (ctx.swap.amountIn * widen).ceilDiv(BPS7 - widen);
            }
        } else {
            ctx.runLoop();
            ctx.swap.amountIn += (ctx.swap.amountIn * widen).ceilDiv(BPS7 - widen);
        }
    }
}
