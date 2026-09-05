// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title ProofOfFillScore
/// @notice On-chain cache of each agent's Proof-of-Fill score, cheap enough for the
///         ReputationGate opcode to read during a quote.
/// @dev Formula and rationale: docs/SCORE_DESIGN.md
///
///      score = honoredValueUsd · reliability · diversity
///        reliability = honoredCount / (honoredCount + 3·failedCount)   (failures weigh 3x)
///        diversity   = diversityBps / 10_000                           (10_000 - HHI, see below)
///
///      `diversityBps` is a Herfindahl-Hirschman concentration measure over the
///      agent's counterparties, computed off-chain by the attestor from the subgraph
///      because it needs per-counterparty values. It is fully re-derivable from public
///      data by anyone. A maker that only ever trades with itself has HHI = 1, hence
///      diversityBps = 0, hence score = 0 — self-dealing is defeated structurally.
contract ProofOfFillScore is AccessControl {
    bytes32 public constant ATTESTOR_ROLE = keccak256("ATTESTOR_ROLE");

    uint16 internal constant _BPS = 10_000;
    /// @dev Weight applied to failed fills in the reliability term.
    uint256 internal constant _FAILURE_WEIGHT = 3;

    struct Score {
        uint128 honoredValueUsd6; // USD honored, 6 decimals
        uint32 honoredCount;
        uint32 failedCount;
        uint16 diversityBps; // 10_000 - HHI_bps
        uint64 updatedAt;
    }

    mapping(address => Score) private _scores;

    event ScoreUpdated(
        address indexed account,
        uint128 honoredValueUsd6,
        uint32 honoredCount,
        uint32 failedCount,
        uint16 diversityBps,
        uint32 score
    );

    error DiversityOutOfRange(uint16 diversityBps);

    constructor(address admin, address attestor) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ATTESTOR_ROLE, attestor);
    }

    // ---------------------------------------------------------------- writes

    function setScore(address account, Score calldata s) external onlyRole(ATTESTOR_ROLE) {
        _setScore(account, s);
    }

    function setScoreBatch(address[] calldata accounts, Score[] calldata ss) external onlyRole(ATTESTOR_ROLE) {
        require(accounts.length == ss.length, "length mismatch");
        for (uint256 i; i < accounts.length; ++i) {
            _setScore(accounts[i], ss[i]);
        }
    }

    function _setScore(address account, Score calldata s) private {
        require(s.diversityBps <= _BPS, DiversityOutOfRange(s.diversityBps));
        Score memory stored = s;
        stored.updatedAt = uint64(block.timestamp);
        _scores[account] = stored;
        emit ScoreUpdated(
            account, s.honoredValueUsd6, s.honoredCount, s.failedCount, s.diversityBps, computeScore(stored)
        );
    }

    // ----------------------------------------------------------------- reads

    /// @notice The single number the ReputationGate opcode compares against a floor.
    function scoreOf(address account) external view returns (uint32) {
        return computeScore(_scores[account]);
    }

    /// @notice Raw components, for display and for off-chain re-derivation.
    function rawScoreOf(address account) external view returns (Score memory) {
        return _scores[account];
    }

    /// @notice Pure, so the TypeScript port (packages/core/src/score.ts) can be
    ///         differentially tested against it. Never reverts.
    function computeScore(Score memory s) public pure returns (uint32) {
        uint256 denom = uint256(s.honoredCount) + _FAILURE_WEIGHT * uint256(s.failedCount);
        if (denom == 0 || s.honoredValueUsd6 == 0 || s.diversityBps == 0) return 0;

        // base (whole USD) · reliability · diversity, multiplying before dividing.
        uint256 v = uint256(s.honoredValueUsd6) / 1e6;
        v = (v * uint256(s.honoredCount) * uint256(s.diversityBps)) / (denom * uint256(_BPS));

        return v > type(uint32).max ? type(uint32).max : uint32(v);
    }
}
