// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Vm } from "forge-std/Vm.sol";
import { AquaSwapVMTest } from "@1inch/swap-vm/test/base/AquaSwapVMTest.sol";
import { SwapVM } from "@1inch/swap-vm/src/SwapVM.sol";
import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";

import { SolventRouter } from "../src/router/SolventRouter.sol";
import { SolventScore } from "../src/SolventScore.sol";
import { ReputationGate } from "../src/instructions/ReputationGate.sol";

/// @notice C10 - an executable proof that BOTH outcomes exist on-chain.
///
///         The entire pitch rests on two claims:
///           1. a maker commits liquidity WITHOUT depositing it, and
///           2. if she cannot deliver, the fill fails publicly.
///         This test asserts both against real Aqua accounting, so the argument rests on
///         tested behaviour rather than narrative.
contract FillAndRevertTest is AquaSwapVMTest {
    SolventScore internal solventScore;
    address internal attestor = address(0xA77E5);

    /// 1inch SafeERC20 normalises every failed transferFrom to this selector.
    bytes4 internal constant SAFE_TRANSFER_FROM_FAILED = 0xf4059071;
    bytes32 internal constant SWAPPED_SIG =
        keccak256("Swapped(bytes32,address,address,address,address,uint256,uint256)");
    bytes32 internal constant PULLED_SIG = keccak256("Pulled(address,address,bytes32,address,uint256)");

    function _deployRouter() internal override returns (SwapVM) {
        solventScore = new SolventScore(address(this), attestor);
        return new SolventRouter(address(aqua), address(0), address(this), "SwapVM", "1.0.0");
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

    function _count(Vm.Log[] memory logs, bytes32 sig) internal pure returns (uint256 n) {
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics.length > 0 && logs[i].topics[0] == sig) {
                n++;
            }
        }
    }

    /// CLAIM 1: shipping commits liquidity without moving a single token.
    function test_ShipNeverTakesCustody() public {
        MakerSetup memory s = _setup();
        ISwapVM.Order memory order = createStrategy(s);

        tokenA.mint(maker, s.balanceA);
        tokenB.mint(maker, s.balanceB);
        uint256 aBefore = tokenA.balanceOf(maker);
        uint256 bBefore = tokenB.balanceOf(maker);

        bytes32 sh = shipStrategy(order, tokenA, tokenB, s.balanceA, s.balanceB);

        assertEq(tokenA.balanceOf(maker), aBefore, "ship must not move tokenA");
        assertEq(tokenB.balanceOf(maker), bBefore, "ship must not move tokenB");
        assertEq(tokenA.balanceOf(address(aqua)), 0, "Aqua must hold nothing");
        assertEq(tokenB.balanceOf(address(aqua)), 0, "Aqua must hold nothing");

        (uint256 va, uint256 vb) = getAquaBalances(sh);
        assertEq(va, s.balanceA, "virtual balance A recorded");
        assertEq(vb, s.balanceB, "virtual balance B recorded");
    }

    /// CLAIM 2a: an HONOURED fill moves real tokens out of the maker's own wallet.
    function test_HonoredFillMovesRealTokensFromMakerWallet() public {
        MakerSetup memory s = _setup();
        ISwapVM.Order memory order = createStrategy(s);
        bytes32 sh = shipStrategy(order, tokenA, tokenB, s.balanceA, s.balanceB);

        SwapProgram memory p = _prog(100e18);
        mintTokenInToTaker(p);
        mintTokenOutToMaker(p, 200e18);

        uint256 makerOutBefore = tokenB.balanceOf(maker);
        (uint256 aqBefore,) = getAquaBalances(sh);

        vm.recordLogs();
        (uint256 amountIn, uint256 amountOut) = swap(p, order);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertGt(amountOut, 0, "fill produced no output");
        assertEq(tokenB.balanceOf(maker), makerOutBefore - amountOut, "tokens must leave the MAKER'S WALLET");
        (uint256 aqAfter,) = getAquaBalances(sh);
        assertEq(aqAfter, aqBefore + amountIn, "Aqua ledger credited");

        assertEq(_count(logs, SWAPPED_SIG), 1, "exactly one Swapped");
        assertEq(_count(logs, PULLED_SIG), 1, "exactly one Pulled");
    }

    /// CLAIM 2b: a maker who moved her inventory away cannot deliver, and it is public.
    function test_UnderfundedMakerRevertsWithKnownSelector() public {
        MakerSetup memory s = _setup();
        ISwapVM.Order memory order = createStrategy(s);
        shipStrategy(order, tokenA, tokenB, s.balanceA, s.balanceB);

        SwapProgram memory p = _prog(100e18);
        mintTokenInToTaker(p);
        // deliberately NOT funding the maker's tokenOut: phantom liquidity

        bytes memory td = abi.encodePacked(takerData(address(taker), true, true));
        bool reverted;
        bytes memory reason;
        try taker.swap(order, p.amount, td) returns (uint256, uint256) {
            reverted = false;
        } catch (bytes memory r) {
            reverted = true;
            reason = r;
        }

        assertTrue(reverted, "an underfunded maker must fail to deliver");
        assertEq(reason.length, 4, "expected a bare 4-byte selector");
        assertEq(bytes4(reason), SAFE_TRANSFER_FROM_FAILED, "selector must be SafeTransferFromFailed");
    }

    /// THE INDEXING PROBLEM: a full revert destroys every log, so the failure is
    /// invisible to a subgraph. This is why SolventRecorder exists.
    function test_RevertDestroysAllLogs() public {
        MakerSetup memory s = _setup();
        ISwapVM.Order memory order = createStrategy(s);
        shipStrategy(order, tokenA, tokenB, s.balanceA, s.balanceB);

        SwapProgram memory p = _prog(100e18);
        mintTokenInToTaker(p);

        bytes memory td = abi.encodePacked(takerData(address(taker), true, true));
        vm.recordLogs();
        bool reverted;
        try taker.swap(order, p.amount, td) returns (uint256, uint256) {
            reverted = false;
        } catch {
            reverted = true;
        }
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertTrue(reverted, "expected revert");
        assertEq(_count(logs, SWAPPED_SIG), 0, "Swapped must NOT survive a revert");
        assertEq(_count(logs, PULLED_SIG), 0, "Pulled must NOT survive a revert");
    }

    /// A maker can betray AFTER honouring: the same strategy flips from working to failing.
    function test_MakerCanBetrayAfterHonoringFills() public {
        MakerSetup memory s = _setup();
        ISwapVM.Order memory order = createStrategy(s);
        shipStrategy(order, tokenA, tokenB, s.balanceA, s.balanceB);

        SwapProgram memory p = _prog(50e18);
        // fund both the taker contract and this test contract generously - the exact
        // input required is curve-dependent, and this test is about the BETRAYAL, not
        // about hitting a precise amount
        tokenA.mint(address(taker), 500e18);
        tokenA.mint(address(this), 500e18);
        mintTokenOutToMaker(p, 400e18);

        (, uint256 firstOut) = swap(p, order);
        assertGt(firstOut, 0, "first fill must be honoured");

        // the maker moves her remaining inventory away - Aqua never had custody.
        // NOTE: resolve the balance BEFORE the prank; balanceOf() is itself a call and
        // would otherwise consume it, making the transfer run as this test contract.
        uint256 makerRemaining = tokenB.balanceOf(maker);
        vm.prank(maker);
        tokenB.transfer(address(0xdead), makerRemaining);

        bytes memory td = abi.encodePacked(takerData(address(taker), true, true));
        bool reverted;
        try taker.swap(order, 50e18, td) returns (uint256, uint256) {
            reverted = false;
        } catch {
            reverted = true;
        }
        assertTrue(reverted, "after betrayal the identical strategy must fail");
    }
}
