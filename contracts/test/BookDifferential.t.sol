// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { stdJson } from "forge-std/StdJson.sol";
import { SolventBook } from "../src/SolventBook.sol";

/// @notice The TypeScript utilisation mirror must be bit-identical to Solidity.
///         Fixtures come from scripts/gen-book-fixtures.ts with `expected` computed
///         in TypeScript.
contract BookDifferentialTest is Test {
    using stdJson for string;

    SolventBook internal book;

    function setUp() public {
        book = new SolventBook(address(this), address(this));
    }

    function test_TypescriptAndSolidityAgree() public view {
        string memory json = vm.readFile("./test/fixtures/books.json");
        uint256 n = json.readUint(".count");
        assertGt(n, 1000, "fixture set too small");
        for (uint256 i; i < n; ++i) {
            string memory base = string.concat(".cases[", vm.toString(i), "]");
            uint128 c = uint128(json.readUint(string.concat(base, ".committed")));
            uint128 b = uint128(json.readUint(string.concat(base, ".backing")));
            uint256 expected = json.readUint(string.concat(base, ".expected"));
            assertEq(uint256(book.computeUtilisationBps(c, b)), expected, string.concat("case ", vm.toString(i)));
        }
    }
}
