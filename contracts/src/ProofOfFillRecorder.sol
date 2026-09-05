// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title ProofOfFillRecorder
/// @notice Makes a BROKEN PROMISE indexable.
///
/// @dev THE PROBLEM. When an Aqua maker cannot deliver, `Aqua.pull` reverts with
///      `SafeTransferFromFailed()` (0xf4059071) and the whole transaction unwinds -
///      including its logs. A subgraph therefore cannot see the failure at all, even
///      though the reverted transaction is permanently visible on the explorer.
///
///      Router-level try/catch is not available either: SwapVM's `_transferIn`,
///      `_transferOut`, `_transferFrom` and `_transferOrPull` are all `private` and
///      `swap()` is not `virtual`, so the failure cannot be caught and re-emitted from
///      inside a modified router. (Verified empirically - docs/VERIFICATION_REPORT.md V10.)
///
/// @dev TWO WAYS TO RECORD, both emitting this same event so the subgraph treats them
///      identically:
///
///      1. TRUST-MINIMISED - the taker is a contract that try/catches its own swap and
///         calls `recordOwnFailure`. The outer transaction succeeds, so the log survives.
///         Self-reported, but the claim is checkable: a `FillFailed` with a matching
///         `Swapped` in the same transaction is a provable lie.
///
///      2. ATTESTOR-OBSERVED - an EOA taker's swap reverts for real on-chain, and the
///         attestor (a trusted updater in this prototype) scans for `status == 0`
///         receipts targeting the router and records them here, citing the failed
///         transaction hash. Anyone can verify the citation on the explorer.
///
///      Neither path can fabricate a failure that the chain does not corroborate:
///      `failedTxHash` always points at a real reverted transaction.
contract ProofOfFillRecorder is AccessControl {
    bytes32 public constant RECORDER_ROLE = keccak256("RECORDER_ROLE");

    /// @param source 0 = attestor-observed, 1 = taker self-reported
    event FillFailed(
        bytes32 indexed strategyHash,
        address indexed maker,
        address indexed taker,
        address tokenOut,
        uint256 amountOut,
        bytes4 reason,
        bytes32 failedTxHash,
        uint8 source
    );

    /// @notice Emitted before a swap is attempted, by takers using the self-recording path.
    event FillAttempted(bytes32 indexed strategyHash, address indexed maker, address indexed taker, uint256 amountIn);

    error AlreadyRecorded(bytes32 failedTxHash);

    mapping(bytes32 => bool) public recorded;

    constructor(address admin, address recorder) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(RECORDER_ROLE, recorder);
    }

    /// @notice Attestor-observed path. Idempotent per failed transaction.
    function recordFailure(
        bytes32 strategyHash,
        address maker,
        address taker,
        address tokenOut,
        uint256 amountOut,
        bytes4 reason,
        bytes32 failedTxHash
    ) external onlyRole(RECORDER_ROLE) {
        require(!recorded[failedTxHash], AlreadyRecorded(failedTxHash));
        recorded[failedTxHash] = true;
        emit FillFailed(strategyHash, maker, taker, tokenOut, amountOut, reason, failedTxHash, 0);
    }

    /// @notice Taker self-reported path - permissionless, because the caller can only
    ///         report a failure against ITSELF as taker.
    function recordOwnFailure(
        bytes32 strategyHash,
        address maker,
        address tokenOut,
        uint256 amountOut,
        bytes4 reason
    ) external {
        emit FillFailed(strategyHash, maker, msg.sender, tokenOut, amountOut, reason, bytes32(0), 1);
    }

    function announceAttempt(bytes32 strategyHash, address maker, uint256 amountIn) external {
        emit FillAttempted(strategyHash, maker, msg.sender, amountIn);
    }
}
