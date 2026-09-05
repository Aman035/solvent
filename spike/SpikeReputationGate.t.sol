// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { AquaSwapVMTest } from "./base/AquaSwapVMTest.sol";
import { SwapVM } from "../src/SwapVM.sol";
import { ISwapVM } from "../src/interfaces/ISwapVM.sol";
import { Opcode } from "../src/libs/OpcodeList.sol";

import { ProofOfFillSwapVMRouter, ReputationGate, ScoreMock } from "../spike/ProofOfFillSpike.sol";

/// @notice V1 SPIKE — can a custom instruction be appended to SwapVM without
///         disturbing upstream opcodes, and does it work in BOTH quote and swap?
contract SpikeReputationGateTest is AquaSwapVMTest {
    ScoreMock public score;

    function _deployRouter() internal override returns (SwapVM) {
        score = new ScoreMock();
        return new ProofOfFillSwapVMRouter(address(aqua), address(0), address(this), "SwapVM", "1.0.0");
    }

    function _setup() internal pure returns (MakerSetup memory) {
        return MakerSetup({
            balanceA: INITIAL_BALANCE_A,
            balanceB: INITIAL_BALANCE_B,
            priceMin: 0, priceMax: 0,
            protocolFeeBps: 0, feeInBps: 0,
            protocolFeeRecipient: address(0),
            swapType: SwapType.XYC
        });
    }

    function _prog(uint256 amount) internal view returns (SwapProgram memory) {
        return SwapProgram({
            amount: amount, taker: taker,
            tokenA: tokenA, tokenB: tokenB,
            zeroForOne: true, isExactIn: true
        });
    }

    function _gated(bytes memory inner, uint32 floor) internal view returns (bytes memory) {
        return bytes.concat(ReputationGate.build(address(score), floor), inner);
    }

    // A1 — upstream opcode indices are untouched; we occupy a reserved free slot
    function test_A1_UpstreamOpcodeIndicesUnchanged() public pure {
        assertEq(uint8(Opcode.Deadline),    0x20, "Deadline moved");
        assertEq(uint8(Opcode.XYCSwap),     0x50, "XYCSwap moved");
        assertEq(uint8(Opcode.FeeFlatIn),   0x70, "FeeFlatIn moved");
        assertEq(uint8(Opcode.Extruction),  0x04, "Extruction moved");
        assertEq(uint8(ReputationGate.opcode), 0x21, "gate not at reserved 0x21");
    }

    // A2 — an UNGATED stock program on our router reproduces the exact upstream XYC formula
    function test_A2_StockProgramMathUnchangedOnOurRouter() public {
        MakerSetup memory s = _setup();
        ISwapVM.Order memory order = createStrategy(s);
        shipStrategy(order, tokenA, tokenB, s.balanceA, s.balanceB);

        SwapProgram memory p = _prog(100e18);
        mintTokenInToTaker(p);
        mintTokenOutToMaker(p, 200e18);

        (uint256 amountIn, uint256 amountOut) = swap(p, order);
        uint256 expected = s.balanceB * amountIn / (s.balanceA + amountIn);
        assertEq(amountOut, expected, "XYC math diverged on our router");
    }

    // A3 — gate is a pure no-op on price for a taker at/above the floor
    function test_A3_GateIsPriceNeutralAboveFloor() public {
        MakerSetup memory s = _setup();
        score.setScore(address(taker), 5_000);

        ISwapVM.Order memory order = createStrategy(_gated(buildProgram(s), 100));
        shipStrategy(order, tokenA, tokenB, s.balanceA, s.balanceB);

        SwapProgram memory p = _prog(100e18);
        mintTokenInToTaker(p);
        mintTokenOutToMaker(p, 200e18);

        (uint256 amountIn, uint256 amountOut) = swap(p, order);
        uint256 expected = s.balanceB * amountIn / (s.balanceA + amountIn);
        assertEq(amountOut, expected, "gate altered price for a qualified taker");
    }

    // A4 — gate REFUSES a taker below the floor, in the SWAP path
    function test_A4_GateRefusesBelowFloorOnSwap() public {
        MakerSetup memory s = _setup();
        score.setScore(address(taker), 0);

        ISwapVM.Order memory order = createStrategy(_gated(buildProgram(s), 100));
        shipStrategy(order, tokenA, tokenB, s.balanceA, s.balanceB);

        SwapProgram memory p = _prog(100e18);
        mintTokenInToTaker(p);
        mintTokenOutToMaker(p, 200e18);

        vm.expectRevert(abi.encodeWithSelector(
            ReputationGate.TakerBelowReputationFloor.selector,
            address(taker), uint32(0), uint32(100)
        ));
        swap(p, order);
    }

    // A5 — CRITICAL: does the gate also enforce in the STATIC quote path?
    function test_A5_GateRefusesBelowFloorOnQuote() public {
        MakerSetup memory s = _setup();
        // quote() is invoked directly by this contract, and SwapVM sets
        // ctx.query.taker = msg.sender (SwapVM.sol:203) -- so the gate scores address(this)
        score.setScore(address(this), 0);

        ISwapVM.Order memory order = createStrategy(_gated(buildProgram(s), 100));
        shipStrategy(order, tokenA, tokenB, s.balanceA, s.balanceB);

        // NOTE: swapVM.asView().quote(...) is TWO external calls; vm.expectRevert binds
        // to the next one, so resolve asView() first and expect on the quote itself.
        ISwapVM v = swapVM.asView();
        bytes memory td = takerData(address(this), true, true);

        vm.expectRevert(abi.encodeWithSelector(
            ReputationGate.TakerBelowReputationFloor.selector,
            address(this), uint32(0), uint32(100)
        ));
        v.quote(order, 100e18, td);
    }

    // A6 — and the quote SUCCEEDS for a qualified taker
    function test_A6_QuoteSucceedsAboveFloor() public {
        MakerSetup memory s = _setup();
        score.setScore(address(this), 5_000);

        ISwapVM.Order memory order = createStrategy(_gated(buildProgram(s), 100));
        shipStrategy(order, tokenA, tokenB, s.balanceA, s.balanceB);

        (, uint256 amountOut) = quote(_prog(100e18), order);
        uint256 expected = s.balanceB * 100e18 / (s.balanceA + 100e18);
        assertEq(amountOut, expected, "quote diverged for qualified taker");
    }
}
