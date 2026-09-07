// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { AquaSwapVMTest } from "@1inch/swap-vm/test/base/AquaSwapVMTest.sol";
import { SwapVM } from "@1inch/swap-vm/src/SwapVM.sol";
import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { Opcode } from "@1inch/swap-vm/src/libs/OpcodeList.sol";
import { FeeFlatIn } from "@1inch/swap-vm/src/instructions/FeeFlat.sol";

import { SolventRouter } from "../src/router/SolventRouter.sol";
import { SolventBook } from "../src/SolventBook.sol";
import { SolvencyFloor } from "../src/instructions/SolvencyFloor.sol";
import { SolvencySkew } from "../src/instructions/SolvencySkew.sol";

contract SolvencyInstructionsTest is AquaSwapVMTest {
    SolventBook internal book;
    address internal attestor = address(0xA77E5);

    function _deployRouter() internal override returns (SwapVM) {
        book = new SolventBook(address(this), attestor);
        return new SolventRouter(address(aqua), address(0), address(this), "SwapVM", "1.0.0");
    }

    function _setBook(uint128 committed, uint128 backing) internal {
        // the instructions read (ctx.query.maker, ctx.query.tokenOut); with zeroForOne
        // (A in, B out) the promised token is tokenB
        vm.prank(attestor);
        book.setBook(maker, address(tokenB), committed, backing);
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

    function _prog(uint256 amt, bool exactIn) internal view returns (SwapProgram memory) {
        return SwapProgram({
            amount: amt, taker: taker, tokenA: tokenA, tokenB: tokenB, zeroForOne: true, isExactIn: exactIn
        });
    }

    function _shipAndFund(
        bytes memory program,
        MakerSetup memory s,
        bool exactIn
    )
        internal
        returns (ISwapVM.Order memory o, SwapProgram memory p)
    {
        o = createStrategy(program);
        shipStrategy(o, tokenA, tokenB, s.balanceA, s.balanceB);
        p = _prog(exactIn ? 100e18 : 50e18, exactIn);
        tokenA.mint(address(taker), 100_000e18);
        mintTokenOutToMaker(p, 400e18);
    }

    // ---- slot hygiene -----------------------------------------------------
    function test_SlotsAreReservedPlaceholders() public pure {
        assertEq(uint8(SolvencyFloor.opcode), 0x22, "floor in the guards bank");
        assertEq(uint8(SolvencySkew.opcode), 0xb5, "skew in the rates bank");
        assertEq(uint8(Opcode.Deadline), 0x20, "upstream untouched");
        assertEq(uint8(Opcode.BaseFeeAdjuster), 0xb4, "upstream untouched");
    }

    // ---- SolvencyFloor ----------------------------------------------------
    function test_FloorPassesWhenHealthy() public {
        MakerSetup memory s = _setup();
        _setBook(5e18, 10e18); // 50% utilisation
        (ISwapVM.Order memory o, SwapProgram memory p) =
            _shipAndFund(bytes.concat(SolvencyFloor.build(address(book), 9000), buildProgram(s)), s, true);
        (, uint256 out) = swap(p, o);
        assertGt(out, 0, "healthy maker fills normally");
    }

    function test_FloorBoundaryInclusive() public {
        MakerSetup memory s = _setup();
        _setBook(9e18, 10e18); // exactly 9000 bps
        (ISwapVM.Order memory o, SwapProgram memory p) =
            _shipAndFund(bytes.concat(SolvencyFloor.build(address(book), 9000), buildProgram(s)), s, true);
        (, uint256 out) = swap(p, o);
        assertGt(out, 0, "utilisation == max passes");
    }

    function test_FloorDeclinesOverExtendedMakerAtQuoteTime() public {
        MakerSetup memory s = _setup();
        _setBook(30e18, 10e18); // the whitepaper 3x case
        ISwapVM.Order memory o = createStrategy(bytes.concat(SolvencyFloor.build(address(book), 9000), buildProgram(s)));
        shipStrategy(o, tokenA, tokenB, s.balanceA, s.balanceB);

        ISwapVM v = swapVM.asView();
        bytes memory td = takerData(address(this), true, true);
        vm.expectRevert(
            abi.encodeWithSelector(
                SolvencyFloor.MakerBeyondSolvencyFloor.selector, maker, address(tokenB), uint32(30_000), uint32(9000)
            )
        );
        v.quote(o, 100e18, td);
    }

    function test_FloorDeclinesPhantomBook() public {
        MakerSetup memory s = _setup();
        _setBook(1e18, 0); // advertising against nothing
        (ISwapVM.Order memory o, SwapProgram memory p) =
            _shipAndFund(bytes.concat(SolvencyFloor.build(address(book), 9000), buildProgram(s)), s, true);
        bytes memory td = abi.encodePacked(takerData(address(taker), true, true));
        vm.expectRevert(
            abi.encodeWithSelector(
                SolvencyFloor.MakerBeyondSolvencyFloor.selector, maker, address(tokenB), type(uint32).max, uint32(9000)
            )
        );
        taker.swap(o, p.amount, td);
    }

    // ---- SolvencySkew -----------------------------------------------------
    function test_SkewNeutralBelowStart() public {
        MakerSetup memory s = _setup();
        _setBook(5e18, 10e18); // 5000 bps, below start 7000
        (ISwapVM.Order memory o, SwapProgram memory p) =
            _shipAndFund(bytes.concat(SolvencySkew.build(address(book), 7000, 500_000), buildProgram(s)), s, true);
        (uint256 amountIn, uint256 out) = swap(p, o);
        assertEq(out, s.balanceB * amountIn / (s.balanceA + amountIn), "no widening below start");
    }

    /// The core differential: a skewed quote must equal a stock program carrying a
    /// flat fee at exactly the computed widen rate.
    function test_SkewEqualsEquivalentFlatFee_ExactIn() public {
        MakerSetup memory s = _setup();
        _setBook(85e17, 10e18); // 8500 bps; start 7000, span 3000, over 1500
        uint24 maxWiden = 600_000;
        uint256 widen = SolvencySkew.widenFor(8500, 7000, maxWiden);
        assertEq(widen, 300_000, "half the ramp");

        (ISwapVM.Order memory oSkew, SwapProgram memory p) =
            _shipAndFund(bytes.concat(SolvencySkew.build(address(book), 7000, maxWiden), buildProgram(s)), s, true);
        (, uint256 outSkew) = swap(p, oSkew);

        (ISwapVM.Order memory oFee, SwapProgram memory p2) =
            _shipAndFund(bytes.concat(FeeFlatIn.build(uint24(widen)), buildProgram(s)), s, true);
        (, uint256 outFee) = swap(p2, oFee);

        assertEq(outSkew, outFee, "skew must mirror flat-fee arithmetic exactly");
    }

    function test_SkewFullWidenWhenUnderBacked() public {
        MakerSetup memory s = _setup();
        _setBook(30e18, 10e18); // 30000 bps, beyond full
        uint24 maxWiden = 400_000;
        assertEq(SolvencySkew.widenFor(30_000, 7000, maxWiden), maxWiden, "saturates at max");

        (ISwapVM.Order memory oSkew, SwapProgram memory p) =
            _shipAndFund(bytes.concat(SolvencySkew.build(address(book), 7000, maxWiden), buildProgram(s)), s, true);
        (, uint256 outSkew) = swap(p, oSkew);
        (ISwapVM.Order memory oFee, SwapProgram memory p2) =
            _shipAndFund(bytes.concat(FeeFlatIn.build(maxWiden), buildProgram(s)), s, true);
        (, uint256 outFee) = swap(p2, oFee);
        assertEq(outSkew, outFee);
    }

    function test_SkewExactOutBranch() public {
        MakerSetup memory s = _setup();
        _setBook(9e18, 10e18); // 9000 bps
        uint24 maxWiden = 500_000;
        uint256 widen = SolvencySkew.widenFor(9000, 7000, maxWiden);

        (ISwapVM.Order memory oSkew, SwapProgram memory p) =
            _shipAndFund(bytes.concat(SolvencySkew.build(address(book), 7000, maxWiden), buildProgram(s)), s, false);
        (uint256 inSkew,) = swap(p, oSkew);
        (ISwapVM.Order memory oFee, SwapProgram memory p2) =
            _shipAndFund(bytes.concat(FeeFlatIn.build(uint24(widen)), buildProgram(s)), s, false);
        (uint256 inFee,) = swap(p2, oFee);
        assertEq(inSkew, inFee, "exact-out branch mirrors the fee too");
    }

    // ---- composition ------------------------------------------------------
    function test_FloorAndSkewCompose() public {
        MakerSetup memory s = _setup();
        _setBook(88e17, 10e18); // 8800: past skew start, under floor 9500
        (ISwapVM.Order memory o, SwapProgram memory p) = _shipAndFund(
            bytes.concat(
                SolvencyFloor.build(address(book), 9500),
                SolvencySkew.build(address(book), 7000, 500_000),
                buildProgram(s)
            ),
            s,
            true
        );
        (uint256 amountIn, uint256 out) = swap(p, o);
        assertGt(out, 0, "served");
        assertLt(out, s.balanceB * amountIn / (s.balanceA + amountIn), "but wider");
    }

    // ---- fuzz: the promises the readme makes ------------------------------
    function testFuzz_SkewMonotoneInUtilisation(uint32 u1, uint32 u2) public pure {
        u1 = uint32(bound(u1, 0, 60_000));
        u2 = uint32(bound(u2, u1, 60_000));
        assertLe(SolvencySkew.widenFor(u1, 7000, 500_000), SolvencySkew.widenFor(u2, 7000, 500_000));
    }

    function testFuzz_SkewNeverExceedsMax(uint32 u, uint32 start, uint24 maxW) public pure {
        start = uint32(bound(start, 0, 9999));
        maxW = uint24(bound(maxW, 0, 9_999_999));
        assertLe(SolvencySkew.widenFor(u, start, maxW), maxW);
    }
}
