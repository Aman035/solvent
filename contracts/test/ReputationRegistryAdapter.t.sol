// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { ReputationRegistryAdapter } from "../src/ReputationRegistryAdapter.sol";
import { ProofOfFillScore } from "../src/ProofOfFillScore.sol";

/// Minimal stand-in for the ERC-8004 IdentityRegistry (which is solc 0.8.19 + OZ v4,
/// so it cannot be compiled into this project's build - see contracts/erc8004-artifacts).
contract MockIdentity {
    mapping(uint256 => address) public owners;
    mapping(uint256 => address) public wallets;

    function setAgent(uint256 id, address owner, address wallet) external {
        owners[id] = owner;
        wallets[id] = wallet;
    }

    function ownerOf(uint256 id) external view returns (address) {
        return owners[id];
    }

    function getAgentWallet(uint256 id) external view returns (address) {
        return wallets[id];
    }

    function agentExists(uint256 id) external view returns (bool) {
        return owners[id] != address(0);
    }
}

contract ReputationRegistryAdapterTest is Test {
    MockIdentity internal identity;
    ProofOfFillScore internal score;
    ReputationRegistryAdapter internal adapter;

    address internal attestor = address(0xA77E5);
    address internal ownerWallet = address(0x0117E4);
    address internal execWallet = address(0xE7EC);

    function setUp() public {
        identity = new MockIdentity();
        score = new ProofOfFillScore(address(this), attestor);
        adapter = new ReputationRegistryAdapter(address(identity), address(score));
    }

    function _score(address who, uint128 usd6, uint32 h, uint16 div) internal {
        vm.prank(attestor);
        score.setScore(
            who,
            ProofOfFillScore.Score({
                honoredValueUsd6: usd6, honoredCount: h, failedCount: 0, diversityBps: div, updatedAt: 0
            })
        );
    }

    function test_PrefersNominatedExecutionWallet() public {
        identity.setAgent(1, ownerWallet, execWallet);
        _score(execWallet, 5000e6, 5, 10_000);
        _score(ownerWallet, 1e6, 1, 10_000);

        assertEq(adapter.walletOf(1), execWallet, "must prefer the nominated wallet");
        assertEq(adapter.scoreByAgentId(1), 5000, "score must follow the execution wallet");
    }

    function test_FallsBackToOwnerWhenNoWalletSet() public {
        identity.setAgent(2, ownerWallet, address(0));
        _score(ownerWallet, 3000e6, 3, 10_000);

        assertEq(adapter.walletOf(2), ownerWallet);
        assertEq(adapter.scoreByAgentId(2), 3000);
    }

    function test_RevertsForUnknownAgent() public {
        vm.expectRevert(abi.encodeWithSelector(ReputationRegistryAdapter.AgentDoesNotExist.selector, uint256(99)));
        adapter.scoreByAgentId(99);
    }

    function test_BatchResolvesAll() public {
        identity.setAgent(1, ownerWallet, execWallet);
        identity.setAgent(2, address(0xBEEF), address(0));
        _score(execWallet, 5000e6, 5, 10_000);
        _score(address(0xBEEF), 800e6, 2, 10_000);

        uint256[] memory ids = new uint256[](2);
        ids[0] = 1;
        ids[1] = 2;
        uint32[] memory out = adapter.scoresByAgentIds(ids);
        assertEq(out[0], 5000);
        assertEq(out[1], 800);
    }

    function test_UnscoredAgentReadsZero() public {
        identity.setAgent(3, address(0xC0FFEE), address(0));
        assertEq(adapter.scoreByAgentId(3), 0);
    }
}
