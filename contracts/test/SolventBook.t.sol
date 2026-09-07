// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { SolventBook } from "../src/SolventBook.sol";

contract SolventBookTest is Test {
    SolventBook internal book;
    address internal attestor = address(0xA77E5);
    address internal maker = address(0x1);
    address internal weth = address(0x2);

    function setUp() public {
        book = new SolventBook(address(this), attestor);
    }

    function _set(uint128 c, uint128 b) internal {
        vm.prank(attestor);
        book.setBook(maker, weth, c, b);
    }

    // ---- utilisation semantics ------------------------------------------
    function test_EmptyBookIsZero() public view {
        assertEq(book.utilisationBps(maker, weth), 0);
    }

    function test_FullyBackedIsExactly10000() public {
        _set(10e18, 10e18);
        assertEq(book.utilisationBps(maker, weth), 10_000);
    }

    function test_HalfUsedIs5000() public {
        _set(5e18, 10e18);
        assertEq(book.utilisationBps(maker, weth), 5000);
    }

    /// The whitepaper's own example: $300k advertised on $100k of backing.
    function test_ThreeToOneOvercommitIs30000() public {
        _set(300_000e6, 100_000e6);
        assertEq(book.utilisationBps(maker, weth), 30_000, "3x over-committed");
    }

    function test_AdvertisingAgainstNothingSaturates() public {
        _set(1, 0);
        assertEq(book.utilisationBps(maker, weth), type(uint32).max);
    }

    function test_CommittedZeroBeatsBackingZero() public {
        _set(0, 0);
        assertEq(book.utilisationBps(maker, weth), 0, "no commitments means no exposure");
    }

    // ---- writes ----------------------------------------------------------
    function test_BatchSet() public {
        address[] memory ms = new address[](2);
        ms[0] = maker;
        ms[1] = address(0x9);
        address[] memory ts = new address[](2);
        ts[0] = weth;
        ts[1] = weth;
        uint128[] memory cs = new uint128[](2);
        cs[0] = 2e18;
        cs[1] = 4e18;
        uint128[] memory bs = new uint128[](2);
        bs[0] = 1e18;
        bs[1] = 8e18;
        vm.prank(attestor);
        book.setBooks(ms, ts, cs, bs);
        assertEq(book.utilisationBps(maker, weth), 20_000);
        assertEq(book.utilisationBps(address(0x9), weth), 5000);
    }

    function test_BatchLengthMismatchReverts() public {
        address[] memory one = new address[](1);
        one[0] = maker;
        address[] memory two = new address[](2);
        uint128[] memory u1 = new uint128[](1);
        vm.prank(attestor);
        vm.expectRevert(SolventBook.LengthMismatch.selector);
        book.setBooks(one, two, u1, u1);
    }

    function test_OnlyAttestorWrites() public {
        bytes32 role = book.ATTESTOR_ROLE();
        vm.prank(address(0xBAD));
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, address(0xBAD), role)
        );
        book.setBook(maker, weth, 1, 1);
    }

    function test_UpdatedAtStamped() public {
        vm.warp(1_800_000_123);
        _set(1e18, 1e18);
        assertEq(book.bookOf(maker, weth).updatedAt, 1_800_000_123);
    }

    // ---- invariant-flavoured fuzz ---------------------------------------
    function testFuzz_NeverReverts(uint128 c, uint128 b) public view {
        book.computeUtilisationBps(c, b);
    }

    function testFuzz_MonotoneInCommitted(uint128 c1, uint128 c2, uint128 b) public view {
        b = uint128(bound(b, 1, type(uint128).max));
        c2 = uint128(bound(c2, c1, type(uint128).max));
        assertLe(book.computeUtilisationBps(c1, b), book.computeUtilisationBps(c2, b));
    }

    function testFuzz_AntitoneInBacking(uint128 c, uint128 b1, uint128 b2) public view {
        c = uint128(bound(c, 1, type(uint128).max));
        b1 = uint128(bound(b1, 1, type(uint128).max));
        b2 = uint128(bound(b2, b1, type(uint128).max));
        assertGe(book.computeUtilisationBps(c, b1), book.computeUtilisationBps(c, b2));
    }

    function testFuzz_OverTenThousandIffUnderBacked(uint128 c, uint128 b) public view {
        b = uint128(bound(b, 1, type(uint128).max));
        c = uint128(bound(c, 1, type(uint128).max));
        uint32 u = book.computeUtilisationBps(c, b);
        if (c > b) {
            assertGe(u, 10_000);
        } else {
            assertLe(u, 10_000);
        }
    }
}
