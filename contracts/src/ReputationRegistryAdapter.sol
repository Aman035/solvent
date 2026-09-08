// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ISolventScore } from "./interfaces/ISolventScore.sol";

interface IIdentityRegistryMin {
    function ownerOf(uint256 tokenId) external view returns (address);
    function getAgentWallet(uint256 agentId) external view returns (address wallet);
    function agentExists(uint256 agentId) external view returns (bool);
}

/// @title ReputationRegistryAdapter
/// @notice Reads a Proof-of-Fill score by ERC-8004 **agentId** rather than by wallet.
///
/// @dev Proof-of-Fill is keyed by ADDRESS, because that is what SwapVM sees at execution
///      time (`ctx.query.taker == msg.sender`). ERC-8004 is keyed by AGENT ID, an ERC-721
///      token. Anything consuming both - a wallet, an agent framework, another contract -
///      needs to cross that boundary, and doing it off-chain would mean every consumer
///      reimplementing the same lookup.
///
/// @dev Resolution order matches the ERC-8004 spec's intent:
///        1. `getAgentWallet(agentId)` - the wallet the agent explicitly nominates for
///           payouts and execution. This is the correct answer when it is set.
///        2. `ownerOf(agentId)` - the NFT holder, as a fallback when no wallet is set.
///      An agent that has nominated a separate execution wallet is scored on THAT wallet,
///      which is where its fills actually settle.
contract ReputationRegistryAdapter {
    IIdentityRegistryMin public immutable IDENTITY;
    ISolventScore public immutable SCORE;

    error AgentDoesNotExist(uint256 agentId);

    constructor(address identityRegistry, address proofOfFillScore) {
        IDENTITY = IIdentityRegistryMin(identityRegistry);
        SCORE = ISolventScore(proofOfFillScore);
    }

    /// @notice The wallet whose delivery record represents this agent.
    function walletOf(uint256 agentId) public view returns (address) {
        require(IDENTITY.agentExists(agentId), AgentDoesNotExist(agentId));
        address nominated = IDENTITY.getAgentWallet(agentId);
        if (nominated != address(0)) {
            return nominated;
        }
        return IDENTITY.ownerOf(agentId);
    }

    /// @notice Proof-of-Fill score for an ERC-8004 agent id.
    function scoreByAgentId(uint256 agentId) external view returns (uint32) {
        return SCORE.scoreOf(walletOf(agentId));
    }

    /// @notice Batch form, so a UI or agent framework can price a whole candidate set
    ///         in one call instead of N round trips.
    function scoresByAgentIds(uint256[] calldata agentIds) external view returns (uint32[] memory scores) {
        scores = new uint32[](agentIds.length);
        for (uint256 i; i < agentIds.length; ++i) {
            scores[i] = SCORE.scoreOf(walletOf(agentIds[i]));
        }
    }
}
