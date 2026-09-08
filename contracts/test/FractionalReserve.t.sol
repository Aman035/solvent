// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { AquaSwapVMTest } from "@1inch/swap-vm/test/base/AquaSwapVMTest.sol";
import { SwapVM } from "@1inch/swap-vm/src/SwapVM.sol";
import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { SolventRouter } from "../src/router/SolventRouter.sol";
import { ProofOfFillScore } from "../src/ProofOfFillScore.sol";

/// @notice Is FRACTIONAL RESERVE possible on Aqua?
///
///         Aqua never takes custody: a maker's committed inventory stays in their own
///         wallet. Nothing stops the same wallet from backing SEVERAL strategies at once.
///         If that is true, then every strategy can look individually solvent while the
///         maker is, in aggregate, advertising more than they hold - and no per-strategy
///         check can detect it.
///
///         This test exists to establish whether that is real before anything is built
///         on top of it.
contract FractionalReserveTest is AquaSwapVMTest {
    ProofOfFillScore internal pofScore;

    function _deployRouter() internal override returns (SwapVM) {
        pofScore = new ProofOfFillScore(address(this), address(0xA77E5));
        return new SolventRouter(address(aqua), address(0), address(this), "SwapVM", "1.0.0");
    }

    function _setup(uint256 a, uint256 b) internal pure returns (MakerSetup memory) {
        return MakerSetup({
            balanceA: a,
            balanceB: b,
            priceMin: 0,
            priceMax: 0,
            protocolFeeBps: 0,
            feeInBps: 0,
            protocolFeeRecipient: address(0),
            swapType: SwapType.XYC
        });
    }

    /// Can ONE wallet back THREE strategies, each advertising its entire balance?
    function test_OneWalletCanBackManyStrategies() public {
        // the maker holds exactly 10 tokenB, and nothing more
        tokenA.mint(maker, 20_000e18);
        tokenB.mint(maker, 10e18);
        uint256 held = tokenB.balanceOf(maker);
        assertEq(held, 10e18, "maker holds 10");

        bytes32[] memory hashes = new bytes32[](3);
        for (uint256 i; i < 3; ++i) {
            MakerSetup memory s = _setup(1000e18, 10e18);
            // distinct salt per strategy so each is a separate Aqua position
            ISwapVM.Order memory order = createStrategy(buildProgram(s));
            hashes[i] = shipStrategy(order, tokenA, tokenB, s.balanceA, s.balanceB);
        }

        uint256 advertised;
        for (uint256 i; i < 3; ++i) {
            (, uint256 b) = getAquaBalances(hashes[i]);
            advertised += b;
            assertEq(b, 10e18, "each strategy individually advertises the full balance");
        }

        assertEq(tokenB.balanceOf(maker), held, "shipping moved nothing");
        assertEq(advertised, 30e18, "aggregate advertised across strategies");
        assertGt(advertised, held, "FRACTIONAL RESERVE: advertised exceeds held");

        // the reserve ratio a per-strategy check can never see
        uint256 reserveRatioBps = (held * 10_000) / advertised;
        assertEq(reserveRatioBps, 3333, "33.33 pct reserve - each strategy still looks fully backed");
    }

    /// The first taker is served; the position is only unsound once demand arrives.
    function test_OverCommittedMakerServesUntilInventoryRunsOut() public {
        tokenA.mint(maker, 40_000e18);
        tokenB.mint(maker, 10e18);

        bytes32[] memory hashes = new bytes32[](3);
        ISwapVM.Order[] memory orders = new ISwapVM.Order[](3);
        for (uint256 i; i < 3; ++i) {
            MakerSetup memory s = _setup(1000e18, 10e18);
            orders[i] = createStrategy(buildProgram(s));
            hashes[i] = shipStrategy(orders[i], tokenA, tokenB, s.balanceA, s.balanceB);
        }

        // drain the wallet through the FIRST strategy
        SwapProgram memory p = SwapProgram({
            amount: 9000e18, taker: taker, tokenA: tokenA, tokenB: tokenB, zeroForOne: true, isExactIn: true
        });
        tokenA.mint(address(taker), 100_000e18);
        (, uint256 out) = swap(p, orders[0]);
        assertGt(out, 0, "first taker is served normally");

        uint256 remaining = tokenB.balanceOf(maker);
        assertLt(remaining, 2e18, "wallet is now nearly empty");

        // strategy 2 still advertises 10 tokenB it cannot deliver
        (, uint256 stillAdvertised) = getAquaBalances(hashes[1]);
        assertEq(stillAdvertised, 10e18, "second strategy advertises unchanged");
        assertGt(stillAdvertised, remaining, "and is now unbacked");

        // a taker arriving at strategy 2 gets a revert, having done nothing wrong
        bytes memory td = abi.encodePacked(takerData(address(taker), true, true));
        bool reverted;
        try taker.swap(orders[1], 9000e18, td) returns (uint256, uint256) {
            reverted = false;
        } catch {
            reverted = true;
        }
        assertTrue(reverted, "the second taker is failed by the FIRST taker's activity");
    }
}
