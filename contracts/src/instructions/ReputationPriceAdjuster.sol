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

import { IProofOfFillScore } from "../interfaces/IProofOfFillScore.sol";

/// @notice ReputationPriceAdjuster opcode — widen the quote for takers below a score
///         threshold, instead of refusing them outright.
///
/// @dev Encoding: [address scoreOracle][uint32 minScore][uint24 widenBps]
///      `widenBps` is in the same 1e7 unit upstream's fee instructions use.
///
/// @dev Occupies `Opcode._b3`, a free slot in the **rates tuning** bank (0xb0-0xcf),
///      alongside `RequireMinRate`, `AdjustMinRate`, `OraclePriceAdjuster` and
///      `BaseFeeAdjuster`. It belongs here rather than in the guards bank because it
///      MUTATES SWAP REGISTERS, which disqualifies it from being a `Strategies` prefix.
///
/// @dev Like upstream's `FeeFlatIn`, this is a WRAPPER instruction: it adjusts a
///      register, calls `ctx.runLoop()` to execute the remainder of the program, then
///      re-adjusts. It must therefore be placed BEFORE the pricing instruction — the
///      program builder enforces this.
///
/// @dev The exact-in / exact-out branches mirror `FeeFlatIn.exec` exactly, so a widened
///      quote is arithmetically identical to a stock program carrying an equivalent fee.
///      A taker at or above `minScore` pays nothing extra: the instruction short-circuits
///      to a plain `runLoop()`, making it provably price-neutral for qualified takers.
library ReputationPriceAdjuster {
    using InstructionArgs for bytes;
    using InstructionArgs for bytes32;

    using MemoryPtrLib for MemoryPtr;
    using InstructionBuilder for MemoryPtr;

    using ContextLib for Context;
    using Math for uint256;

    error WidenBpsOutOfRange(uint24 widenBps);

    Opcode internal constant opcode = Opcode._b3;

    /// @dev Same denominator upstream uses for fee rates.
    uint256 internal constant BPS = 1e7;

    function sizeOf() internal pure returns (uint256) {
        return InstructionBuilder.sizeOf() + 20 + 4 + 3;
    }

    function build(address scoreOracle, uint32 minScore, uint24 widenBps) internal pure returns (bytes memory) {
        return build(MemoryPtrLib.alloc(sizeOf()), scoreOracle, minScore, widenBps).resolve();
    }

    function build(
        MemoryPtr ptrStart,
        address scoreOracle,
        uint32 minScore,
        uint24 widenBps
    )
        internal
        pure
        returns (MemoryPtr ptr)
    {
        require(widenBps < BPS, WidenBpsOutOfRange(widenBps));
        ptr = ptrStart.pushHeader(opcode);
        ptr = ptr.push(scoreOracle).push(uint256(minScore), 4).push(uint256(widenBps), 3);
        ptrStart.patchLength(ptr);
    }

    function parse(bytes calldata args) internal pure returns (address scoreOracle, uint32 minScore, uint24 widenBps) {
        scoreOracle = args.at(0).asAddress();
        minScore = args.at(20).asU32();
        widenBps = args.at(24).asU24();
    }

    function exec(Context memory ctx, bytes calldata args) internal {
        (address scoreOracle, uint32 minScore, uint24 widenBps) = parse(args);

        uint32 score = IProofOfFillScore(scoreOracle).scoreOf(ctx.query.taker);
        if (score >= minScore) {
            ctx.runLoop(); // qualified taker: provably identical to a program without this instruction
            return;
        }

        // Below threshold: charge `widenBps`, mirroring FeeFlatIn's exact-in/exact-out branches.
        if (ctx.query.isExactIn) {
            uint256 widen = (ctx.swap.amountIn * widenBps).ceilDiv(BPS);
            ctx.swap.amountIn -= widen;

            uint256 reduction = ctx.swap.amountIn;
            ctx.runLoop();
            reduction -= ctx.swap.amountIn;

            if (reduction == 0) {
                ctx.swap.amountIn += widen;
            } else {
                ctx.swap.amountIn += (ctx.swap.amountIn * widenBps).ceilDiv(BPS - widenBps);
            }
        } else {
            ctx.runLoop();
            ctx.swap.amountIn += (ctx.swap.amountIn * widenBps).ceilDiv(BPS - widenBps);
        }
    }
}
