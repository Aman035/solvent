// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title SolventBook
/// @notice The on-chain copy of every maker's aggregate balance sheet: what they have
///         committed across ALL their Aqua strategies for a token, against what their
///         wallet actually holds and has approved.
///
/// @dev Aqua cannot produce this number. Balances are stored per
///      (maker, app, strategyHash, token) with no enumeration, no per-maker total and
///      no event carrying the aggregate. The only way to know a maker's book is to
///      replay every Shipped, Docked, Pulled and Pushed since genesis, which is what
///      the Solvent subgraph does; the attestor publishes the result here so that the
///      SolvencyFloor and SolvencySkew instructions can read it during a quote.
///
///      TRUST: the attestor is a trusted updater in this deployment. Every figure it
///      writes is re-derivable by anyone from the same public index, and `updatedAt`
///      is stored so consumers can judge staleness for themselves.
contract SolventBook is AccessControl {
    bytes32 public constant ATTESTOR_ROLE = keccak256("ATTESTOR_ROLE");

    uint32 internal constant _BPS = 10_000;

    struct Book {
        uint128 committed; // aggregate virtual balances across every strategy
        uint128 backing; // min(wallet balance, allowance to Aqua) at attestation time
        uint64 updatedAt;
    }

    mapping(address => mapping(address => Book)) private _books;

    event BookUpdated(
        address indexed maker, address indexed token, uint128 committed, uint128 backing, uint32 utilisationBps
    );

    error LengthMismatch();

    constructor(address admin, address attestor) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ATTESTOR_ROLE, attestor);
    }

    // ---------------------------------------------------------------- writes

    function setBook(
        address maker,
        address token,
        uint128 committed,
        uint128 backing
    )
        external
        onlyRole(ATTESTOR_ROLE)
    {
        _set(maker, token, committed, backing);
    }

    function setBooks(
        address[] calldata makers,
        address[] calldata tokens,
        uint128[] calldata committed,
        uint128[] calldata backing
    )
        external
        onlyRole(ATTESTOR_ROLE)
    {
        require(
            makers.length == tokens.length && makers.length == committed.length && makers.length == backing.length,
            LengthMismatch()
        );
        for (uint256 i; i < makers.length; ++i) {
            _set(makers[i], tokens[i], committed[i], backing[i]);
        }
    }

    function _set(address maker, address token, uint128 committed, uint128 backing) private {
        _books[maker][token] = Book({ committed: committed, backing: backing, updatedAt: uint64(block.timestamp) });
        emit BookUpdated(maker, token, committed, backing, computeUtilisationBps(committed, backing));
    }

    // ----------------------------------------------------------------- reads

    function bookOf(address maker, address token) external view returns (Book memory) {
        return _books[maker][token];
    }

    /// @notice How loaded is this maker's book for this token, in basis points.
    ///         10_000 means committed exactly equals backing; ABOVE 10_000 means the
    ///         maker is advertising more than it can deliver.
    function utilisationBps(address maker, address token) external view returns (uint32) {
        Book storage b = _books[maker][token];
        return computeUtilisationBps(b.committed, b.backing);
    }

    /// @notice Pure and total, so the TypeScript mirror can be differential-tested
    ///         against it (packages/core/src/book.ts). Never reverts.
    function computeUtilisationBps(uint128 committed, uint128 backing) public pure returns (uint32) {
        if (committed == 0) {
            return 0;
        }
        if (backing == 0) {
            return type(uint32).max; // advertising against nothing
        }
        uint256 v = (uint256(committed) * _BPS) / uint256(backing);
        return v > type(uint32).max ? type(uint32).max : uint32(v);
    }
}
