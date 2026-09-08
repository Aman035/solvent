// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { AquaSwapVMTest } from "@1inch/swap-vm/test/base/AquaSwapVMTest.sol";
import { SwapVM } from "@1inch/swap-vm/src/SwapVM.sol";
import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { Opcode } from "@1inch/swap-vm/src/libs/OpcodeList.sol";

import { SolventRouter } from "../src/router/SolventRouter.sol";
import { SolventScore } from "../src/SolventScore.sol";
import { ReputationGate } from "../src/instructions/ReputationGate.sol";
import { ReputationPriceAdjuster } from "../src/instructions/ReputationPriceAdjuster.sol";

contract ReputationGateTest is AquaSwapVMTest {
    SolventScore internal solventScore;
    address internal attestor = address(0xA77E5);

    function _deployRouter() internal override returns (SwapVM) {
        solventScore = new SolventScore(address(this), attestor);
        return new SolventRouter(address(aqua), address(0), address(this), "SwapVM", "1.0.0");
    }

    function _setScore(address who, uint32 raw) internal {
        // raw whole-USD score with perfect reliability and diversity
        vm.prank(attestor);
        solventScore.setScore(
            who,
            SolventScore.Score({
                honoredValueUsd6: uint128(raw) * 1e6,
                honoredCount: 1,
                failedCount: 0,
                diversityBps: 10_000,
                updatedAt: 0
            })
        );
    }

    function _setup() internal pure returns (MakerSetup memory) {
        return MakerSetup({
            balanceA: INITIAL_BALANCE_A,
            balanceB: INITIAL_BALANCE_B,
            priceMin: 0,
            priceMax: 0,
            protocolFeeBps: 0,
            feeInBps: 0,
            protocolFeeRecipient: address(0),
            swapType: SwapType.XYC
        });
    }

    function _prog(uint256 amt) internal view returns (SwapProgram memory) {
        return
            SwapProgram({
                amount: amt, taker: taker, tokenA: tokenA, tokenB: tokenB, zeroForOne: true, isExactIn: true
            });
    }

    function _ship(bytes memory program, MakerSetup memory s) internal returns (ISwapVM.Order memory o) {
        o = createStrategy(program);
        shipStrategy(o, tokenA, tokenB, s.balanceA, s.balanceB);
    }

    function _fund(SwapProgram memory p) internal {
        mintTokenInToTaker(p);
        mintTokenOutToMaker(p, 200e18);
    }

    function _expectedXycOut(MakerSetup memory s, uint256 amountIn) internal pure returns (uint256) {
        return s.balanceB * amountIn / (s.balanceA + amountIn);
    }

    // ============================ opcode hygiene ============================

    function test_UpstreamOpcodeIndicesUnchanged() public pure {
        assertEq(uint8(Opcode.Stop), 0x00);
        assertEq(uint8(Opcode.Extruction), 0x04);
        assertEq(uint8(Opcode.Deadline), 0x20);
        assertEq(uint8(Opcode.XYCSwap), 0x50);
        assertEq(uint8(Opcode.FeeFlatIn), 0x70);
        assertEq(uint8(Opcode.RequireMinRate), 0xb0);
        assertEq(uint8(Opcode.BaseFeeAdjuster), 0xb4);
    }

    function test_OurInstructionsOccupyReservedSlots() public pure {
        assertEq(uint8(ReputationGate.opcode), 0x21, "gate must sit in the guards bank");
        assertEq(uint8(ReputationPriceAdjuster.opcode), 0xb3, "adjuster must sit in the rates bank");
    }

    // ============================ ReputationGate ============================

    function test_GateIsPriceNeutralAboveFloor() public {
        MakerSetup memory s = _setup();
        _setScore(address(taker), 5000);

        ISwapVM.Order memory o =
            _ship(bytes.concat(ReputationGate.build(address(solventScore), 100), buildProgram(s)), s);
        SwapProgram memory p = _prog(100e18);
        _fund(p);

        (uint256 amountIn, uint256 amountOut) = swap(p, o);
        assertEq(amountOut, _expectedXycOut(s, amountIn), "gate must not move price for a qualified taker");
    }

    function test_GateRefusesBelowFloorOnSwap() public {
        MakerSetup memory s = _setup();
        _setScore(address(taker), 0);

        ISwapVM.Order memory o =
            _ship(bytes.concat(ReputationGate.build(address(solventScore), 100), buildProgram(s)), s);
        SwapProgram memory p = _prog(100e18);
        _fund(p);

        vm.expectRevert(
            abi.encodeWithSelector(
                ReputationGate.TakerBelowReputationFloor.selector, address(taker), uint32(0), uint32(100)
            )
        );
        swap(p, o);
    }

    /// The maker's refusal is visible at QUOTE time, not only at execution.
    function test_GateRefusesBelowFloorOnQuote() public {
        MakerSetup memory s = _setup();
        _setScore(address(this), 0);

        ISwapVM.Order memory o =
            _ship(bytes.concat(ReputationGate.build(address(solventScore), 100), buildProgram(s)), s);

        // resolve asView() first: it is its own external call and would consume expectRevert
        ISwapVM v = swapVM.asView();
        bytes memory td = takerData(address(this), true, true);

        vm.expectRevert(
            abi.encodeWithSelector(
                ReputationGate.TakerBelowReputationFloor.selector, address(this), uint32(0), uint32(100)
            )
        );
        v.quote(o, 100e18, td);
    }

    function test_GateQuoteSucceedsAboveFloor() public {
        MakerSetup memory s = _setup();
        _setScore(address(this), 5000);

        ISwapVM.Order memory o =
            _ship(bytes.concat(ReputationGate.build(address(solventScore), 100), buildProgram(s)), s);
        (, uint256 amountOut) = quote(_prog(100e18), o);
        assertEq(amountOut, _expectedXycOut(s, 100e18));
    }

    function test_GateFloorBoundaryIsInclusive() public {
        MakerSetup memory s = _setup();
        _setScore(address(taker), 100); // exactly at the floor

        ISwapVM.Order memory o =
            _ship(bytes.concat(ReputationGate.build(address(solventScore), 100), buildProgram(s)), s);
        SwapProgram memory p = _prog(100e18);
        _fund(p);
        (uint256 amountIn, uint256 amountOut) = swap(p, o);
        assertEq(amountOut, _expectedXycOut(s, amountIn), "score == floor must pass");
    }

    // ====================== ReputationPriceAdjuster ========================

    function test_AdjusterIsPriceNeutralAboveThreshold() public {
        MakerSetup memory s = _setup();
        _setScore(address(taker), 5000);

        ISwapVM.Order memory o = _ship(
            bytes.concat(ReputationPriceAdjuster.build(address(solventScore), 1000, 300_000), buildProgram(s)), s
        );
        SwapProgram memory p = _prog(100e18);
        _fund(p);

        (uint256 amountIn, uint256 amountOut) = swap(p, o);
        assertEq(amountOut, _expectedXycOut(s, amountIn), "qualified taker must get the unwidened price");
    }

    function test_AdjusterWidensBelowThreshold() public {
        MakerSetup memory s = _setup();
        _setScore(address(taker), 10); // below threshold

        ISwapVM.Order memory o = _ship(
            bytes.concat(ReputationPriceAdjuster.build(address(solventScore), 1000, 300_000), buildProgram(s)), s
        );
        SwapProgram memory p = _prog(100e18);
        _fund(p);

        (uint256 amountIn, uint256 amountOut) = swap(p, o);
        assertEq(amountIn, 100e18, "taker-specified exact-in amount is preserved");
        assertLt(amountOut, _expectedXycOut(s, amountIn), "low-score taker must receive strictly less");
    }

    /// @dev build() is an internal library call, so it must be reached through an
    ///      external hop for vm.expectRevert to observe the revert.
    function buildAdjusterExternal(
        address oracle,
        uint32 minScore,
        uint24 widenBps
    )
        external
        pure
        returns (bytes memory)
    {
        return ReputationPriceAdjuster.build(oracle, minScore, widenBps);
    }

    function test_AdjusterRejectsOutOfRangeWidenBps() public {
        vm.expectRevert(abi.encodeWithSelector(ReputationPriceAdjuster.WidenBpsOutOfRange.selector, uint24(10_000_000)));
        this.buildAdjusterExternal(address(solventScore), 1000, 10_000_000);
    }

    // ====================== gate + adjuster composed ========================

    function test_GateAndAdjusterCompose() public {
        MakerSetup memory s = _setup();
        _setScore(address(taker), 500); // passes the floor(100), below the widen threshold(1000)

        ISwapVM.Order memory o = _ship(
            bytes.concat(
                ReputationGate.build(address(solventScore), 100),
                ReputationPriceAdjuster.build(address(solventScore), 1000, 300_000),
                buildProgram(s)
            ),
            s
        );
        SwapProgram memory p = _prog(100e18);
        _fund(p);

        (uint256 amountIn, uint256 amountOut) = swap(p, o);
        assertGt(amountOut, 0, "mid-reputation taker is served");
        assertLt(amountOut, _expectedXycOut(s, amountIn), "but at a widened price");
    }
}
