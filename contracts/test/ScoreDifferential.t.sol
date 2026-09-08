// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { stdJson } from "forge-std/StdJson.sol";
import { SolventScore } from "../src/SolventScore.sol";

/// @notice C16 - the TypeScript port of computeScore must be bit-identical to Solidity.
///
///         The dashboard, the attestor and Bob all display or act on the TS number, while
///         the ReputationGate opcode enforces the Solidity one. A divergence would mean
///         the UI showing a score different from the one actually gating swaps.
///
///         Fixtures (1009 cases incl. hand-picked edges) come from
///         scripts/gen-score-fixtures.ts, where `expected` is computed in TypeScript.
contract ScoreDifferentialTest is Test {
    using stdJson for string;

    SolventScore internal score;

    function setUp() public {
        score = new SolventScore(address(this), address(this));
    }

    function test_TypescriptAndSolidityAgree() public view {
        string memory json = vm.readFile("./test/fixtures/scores.json");
        uint256 n = json.readUint(".count");
        assertGt(n, 1000, "fixture set too small to be meaningful");

        for (uint256 i = 0; i < n; ++i) {
            string memory base = string.concat(".cases[", vm.toString(i), "]");
            SolventScore.Score memory s = SolventScore.Score({
                honoredValueUsd6: uint128(json.readUint(string.concat(base, ".honoredValueUsd6"))),
                honoredCount: uint32(json.readUint(string.concat(base, ".honoredCount"))),
                failedCount: uint32(json.readUint(string.concat(base, ".failedCount"))),
                diversityBps: uint16(json.readUint(string.concat(base, ".diversityBps"))),
                updatedAt: 0
            });
            uint256 expected = json.readUint(string.concat(base, ".expected"));
            assertEq(uint256(score.computeScore(s)), expected, string.concat("divergence at case ", vm.toString(i)));
        }
    }
}
