// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { ProofOfFillScore } from "../../src/ProofOfFillScore.sol";

/// @notice Stateful handler: drives the score contract through random attestor updates,
///         so the invariants below hold over sequences of writes, not just single calls.
contract ScoreHandler is Test {
    ProofOfFillScore public immutable SCORE;
    address public constant ATTESTOR = address(0xA77E5);

    address[] public agents;
    mapping(address => bool) internal known;

    uint256 public maxScoreSeen;

    constructor(ProofOfFillScore score_) {
        SCORE = score_;
    }

    function setScore(uint256 agentSeed, uint128 usd6, uint32 honored, uint32 failed, uint16 diversityBps) external {
        address agent = address(uint160(bound(agentSeed, 1, 20)));
        diversityBps = uint16(bound(diversityBps, 0, 10_000));
        honored = uint32(bound(honored, 0, 1_000_000));
        failed = uint32(bound(failed, 0, 1_000_000));

        if (!known[agent]) {
            known[agent] = true;
            agents.push(agent);
        }

        vm.prank(ATTESTOR);
        SCORE.setScore(
            agent,
            ProofOfFillScore.Score({
                honoredValueUsd6: usd6,
                honoredCount: honored,
                failedCount: failed,
                diversityBps: diversityBps,
                updatedAt: 0
            })
        );

        uint256 s = SCORE.scoreOf(agent);
        if (s > maxScoreSeen) {
            maxScoreSeen = s;
        }
    }

    function agentCount() external view returns (uint256) {
        return agents.length;
    }
}

/// @notice C11 - invariants of the settlement score.
///
///         These are the properties the whole design depends on. If any of them can be
///         broken, the score is not a trustworthy signal and the ReputationGate opcode
///         is enforcing something meaningless.
contract ScoreInvariantsTest is Test {
    ProofOfFillScore internal score;
    ScoreHandler internal handler;

    function setUp() public {
        score = new ProofOfFillScore(address(this), address(0xA77E5));
        handler = new ScoreHandler(score);
        targetContract(address(handler));
    }

    /// A score can never exceed the raw USD value actually delivered.
    /// Reliability and diversity are both <= 1, so they can only ever reduce it.
    function invariant_ScoreNeverExceedsHonoredValue() public view {
        uint256 n = handler.agentCount();
        for (uint256 i; i < n; ++i) {
            address a = handler.agents(i);
            ProofOfFillScore.Score memory s = score.rawScoreOf(a);
            uint256 base = uint256(s.honoredValueUsd6) / 1e6;
            if (base > type(uint32).max) {
                base = type(uint32).max;
            }
            assertLe(uint256(score.scoreOf(a)), base, "score exceeded raw honored value");
        }
    }

    /// THE anti-wash-trading invariant. A maker trading only with itself has HHI = 1,
    /// hence diversityBps = 0, hence a score of exactly zero - no matter how much
    /// volume it fabricates.
    function invariant_ZeroDiversityAlwaysScoresZero() public view {
        uint256 n = handler.agentCount();
        for (uint256 i; i < n; ++i) {
            address a = handler.agents(i);
            if (score.rawScoreOf(a).diversityBps == 0) {
                assertEq(score.scoreOf(a), 0, "self-dealing produced a non-zero score");
            }
        }
    }

    /// No delivery, no score - regardless of how favourable the other terms look.
    function invariant_NoHonoredFillsMeansZeroScore() public view {
        uint256 n = handler.agentCount();
        for (uint256 i; i < n; ++i) {
            address a = handler.agents(i);
            if (score.rawScoreOf(a).honoredCount == 0) {
                assertEq(score.scoreOf(a), 0, "scored without honouring anything");
            }
        }
    }

    /// The score is a uint32 by construction and must never wrap.
    function invariant_ScoreFitsUint32() public view {
        assertLe(handler.maxScoreSeen(), uint256(type(uint32).max), "score overflowed uint32");
    }

    /// computeScore is pure and total: it must not revert for ANY stored state.
    function invariant_ComputeScoreIsTotal() public view {
        uint256 n = handler.agentCount();
        for (uint256 i; i < n; ++i) {
            score.computeScore(score.rawScoreOf(handler.agents(i)));
        }
    }
}
