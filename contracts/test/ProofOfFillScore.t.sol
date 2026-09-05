// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { ProofOfFillScore } from "../src/ProofOfFillScore.sol";

contract ProofOfFillScoreTest is Test {
    ProofOfFillScore internal score;
    address internal admin = address(0xA11CE);
    address internal attestor = address(0xA77E5);
    address internal alice = address(0x1);
    address internal outsider = address(0xBAD);

    function setUp() public {
        score = new ProofOfFillScore(admin, attestor);
    }

    function _s(uint128 usd6, uint32 h, uint32 f, uint16 div) internal pure returns (ProofOfFillScore.Score memory) {
        return ProofOfFillScore.Score({
            honoredValueUsd6: usd6, honoredCount: h, failedCount: f, diversityBps: div, updatedAt: 0
        });
    }

    function _set(address who, uint128 usd6, uint32 h, uint32 f, uint16 div) internal {
        vm.prank(attestor);
        score.setScore(who, _s(usd6, h, f, div));
    }

    // ---- edge cases ------------------------------------------------------
    function test_ZeroHistoryScoresZero() public view {
        assertEq(score.computeScore(_s(0, 0, 0, 0)), 0);
    }

    function test_FailuresOnlyScoresZero() public view {
        assertEq(score.computeScore(_s(10_000e6, 0, 8, 10_000)), 0, "no honored fills -> 0");
    }

    /// THE anti-wash-trading property: one counterparty => HHI 1 => diversity 0 => score 0
    function test_SelfDealingScoresZero() public view {
        assertEq(score.computeScore(_s(31_240e6, 12, 0, 0)), 0, "self-dealing must score zero");
    }

    function test_HonestMakerScoresFullValueAtPerfectDiversity() public view {
        assertEq(score.computeScore(_s(31_240e6, 12, 0, 10_000)), 31_240);
    }

    function test_DiversityScalesLinearly() public view {
        // 8320 bps of 31_240 = 25_991 (integer division)
        assertEq(score.computeScore(_s(31_240e6, 12, 0, 8320)), 25_991);
    }

    /// Failures weigh 3x: 10 honored / 1 failed -> 10/(10+3) = 10/13
    function test_FailureWeightingIsThreeToOne() public view {
        uint32 clean = score.computeScore(_s(1300e6, 10, 0, 10_000));
        uint32 dirty = score.computeScore(_s(1300e6, 10, 1, 10_000));
        assertEq(clean, 1300);
        assertEq(dirty, 1000, "1300 * 10/13 == 1000");
        assertLt(dirty, clean);
    }

    /// An honest small maker must beat a high-volume serial reneger.
    function test_SmallHonestBeatsLargeReneger() public view {
        uint32 honest = score.computeScore(_s(1000e6, 5, 0, 8000));
        uint32 reneger = score.computeScore(_s(10_000e6, 2, 8, 7500));
        assertGt(honest, reneger, "reliability must dominate raw volume here");
    }

    function test_OverflowClamps() public view {
        assertEq(score.computeScore(_s(type(uint128).max, 1, 0, 10_000)), type(uint32).max);
    }

    // ---- access control --------------------------------------------------
    function test_OnlyAttestorCanSet() public {
        // NOTE: resolve the role BEFORE prank/expectRevert - score.ATTESTOR_ROLE() is
        // itself an external call and would consume the prank.
        bytes32 roleId = score.ATTESTOR_ROLE();
        ProofOfFillScore.Score memory s = _s(1e6, 1, 0, 10_000);

        vm.prank(outsider);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, outsider, roleId)
        );
        score.setScore(alice, s);
    }

    function test_RejectsDiversityAboveBps() public {
        vm.prank(attestor);
        vm.expectRevert(abi.encodeWithSelector(ProofOfFillScore.DiversityOutOfRange.selector, uint16(10_001)));
        score.setScore(alice, _s(1e6, 1, 0, 10_001));
    }

    function test_SetAndReadRoundTrip() public {
        _set(alice, 31_240e6, 12, 0, 8320);
        assertEq(score.scoreOf(alice), 25_991);
        ProofOfFillScore.Score memory got = score.rawScoreOf(alice);
        assertEq(got.honoredValueUsd6, 31_240e6);
        assertEq(got.honoredCount, 12);
        assertEq(got.diversityBps, 8320);
        assertGt(got.updatedAt, 0, "updatedAt stamped");
    }

    function test_BatchSet() public {
        address[] memory who = new address[](2);
        who[0] = alice;
        who[1] = outsider;
        ProofOfFillScore.Score[] memory ss = new ProofOfFillScore.Score[](2);
        ss[0] = _s(1000e6, 5, 0, 10_000);
        ss[1] = _s(2000e6, 4, 1, 10_000);
        vm.prank(attestor);
        score.setScoreBatch(who, ss);
        assertEq(score.scoreOf(alice), 1000);
        assertEq(score.scoreOf(outsider), 1142); // 2000 * 4/7
    }

    // ---- invariants ------------------------------------------------------
    function testFuzz_NeverReverts(uint128 usd6, uint32 h, uint32 f, uint16 div) public view {
        div = uint16(bound(div, 0, 10_000));
        score.computeScore(_s(usd6, h, f, div)); // must not revert for any input
    }

    function testFuzz_MonotonicInDiversity(uint128 usd6, uint32 h, uint16 a, uint16 b) public view {
        h = uint32(bound(h, 1, 1_000_000));
        a = uint16(bound(a, 0, 10_000));
        b = uint16(bound(b, a, 10_000));
        assertLe(score.computeScore(_s(usd6, h, 0, a)), score.computeScore(_s(usd6, h, 0, b)));
    }

    function testFuzz_MonotonicNonIncreasingInFailures(uint128 usd6, uint32 h, uint32 f1, uint32 f2) public view {
        h = uint32(bound(h, 1, 1_000_000));
        f1 = uint32(bound(f1, 0, 1_000_000));
        f2 = uint32(bound(f2, f1, 1_000_000));
        assertGe(score.computeScore(_s(usd6, h, f1, 10_000)), score.computeScore(_s(usd6, h, f2, 10_000)));
    }

    function testFuzz_NeverExceedsRawValue(uint128 usd6, uint32 h, uint32 f, uint16 div) public view {
        div = uint16(bound(div, 0, 10_000));
        h = uint32(bound(h, 0, 1_000_000));
        uint256 base = uint256(usd6) / 1e6;
        if (base > type(uint32).max) {
            base = type(uint32).max;
        }
        assertLe(score.computeScore(_s(usd6, h, f, div)), base);
    }
}
