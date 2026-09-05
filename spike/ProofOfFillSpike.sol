// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Simulator } from "@1inch/solidity-utils/contracts/mixins/Simulator.sol";

import { Context } from "../src/libs/VM.sol";
import { Opcode, OpcodeOps } from "../src/libs/OpcodeList.sol";
import { MemoryPtr, MemoryPtrLib } from "../src/libs/MemoryPtr.sol";
import { InstructionBuilder } from "../src/libs/InstructionBuilder.sol";
import { InstructionArgs } from "../src/libs/InstructionArgs.sol";
import { SwapVM } from "../src/SwapVM.sol";
import { AquaOpcodes } from "../src/opcodes/AquaOpcodes.sol";
import { ISwapVM } from "../src/interfaces/ISwapVM.sol";
import { ITakerCallbacks } from "../src/interfaces/ITakerCallbacks.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Aqua } from "@1inch/aqua/src/Aqua.sol";

interface IProofOfFillScore {
    function scoreOf(address account) external view returns (uint32);
}

/// @notice Minimal score oracle used only by the spike
contract ScoreMock is IProofOfFillScore {
    mapping(address => uint32) private _scores;
    function setScore(address a, uint32 s) external { _scores[a] = s; }
    function scoreOf(address a) external view returns (uint32) { return _scores[a]; }
}

/// @notice ReputationGate opcode: refuse takers whose Proof-of-Fill score is below a floor
/// @dev Encoding: [address scoreOracle][uint32 floor]
/// @dev Validation-only: does not touch swap registers, so it is prefix-safe
library ReputationGate {
    using InstructionArgs for bytes;
    using InstructionArgs for bytes32;

    using MemoryPtrLib for MemoryPtr;
    using InstructionBuilder for MemoryPtr;

    error TakerBelowReputationFloor(address taker, uint32 score, uint32 floor);

    // Guards bank (0x20-0x3f): next free slot after Deadline (0x20)
    Opcode constant opcode = Opcode._21;

    function sizeOf() internal pure returns (uint256) {
        return InstructionBuilder.sizeOf() + 20 + 4;
    }

    function build(address scoreOracle, uint32 floor) internal pure returns (bytes memory) {
        return build(MemoryPtrLib.alloc(sizeOf()), scoreOracle, floor).resolve();
    }

    function build(MemoryPtr ptrStart, address scoreOracle, uint32 floor) internal pure returns (MemoryPtr ptr) {
        ptr = ptrStart.pushHeader(opcode);
        ptr = ptr.push(scoreOracle).push(uint256(floor), 4);
        ptrStart.patchLength(ptr);
    }

    function parse(bytes calldata args) internal pure returns (address scoreOracle, uint32 floor) {
        scoreOracle = args.at(0).asAddress();
        floor = args.at(20).asU32();
    }

    function exec(Context memory ctx, bytes calldata args) internal view {
        (address scoreOracle, uint32 floor) = parse(args);
        uint32 score = IProofOfFillScore(scoreOracle).scoreOf(ctx.query.taker);
        require(score >= floor, TakerBelowReputationFloor(ctx.query.taker, score, floor));
    }
}

/// @notice Opcode set = official AquaOpcodes + ReputationGate, following the upstream
///   AquaOpcodesDebug extension pattern exactly (override + super fallthrough)
contract ProofOfFillOpcodes is AquaOpcodes {
    using OpcodeOps for Opcode;

    function _runOpcode(Context memory ctx, uint256 opcode, bytes calldata args) internal override {
        if (opcode == ReputationGate.opcode.asU8()) ReputationGate.exec(ctx, args);
        else super._runOpcode(ctx, opcode, args);
    }
}

contract ProofOfFillSwapVMRouter is Simulator, SwapVM, ProofOfFillOpcodes {
    constructor(address aqua, address weth, address owner, string memory name, string memory version)
        SwapVM(aqua, weth, owner, name, version) { }

    function _dispatch(Context memory ctx, uint256 opcode, bytes calldata args) internal override {
        _runOpcode(ctx, opcode, args);
    }
}

/* ------------------------------------------------------------------ *
 *  V10: making a BROKEN PROMISE indexable.
 *  Router-level try/catch is impossible (SwapVM's _transfer* are private
 *  and swap() is not virtual). So the TAKER AGENT is a contract that
 *  try/catches its own swap: the outer tx succeeds, so the FillFailed
 *  log survives and is indexable, while ctx.query.taker stays consistent
 *  (msg.sender to SwapVM is this contract, which IS the agent identity).
 * ------------------------------------------------------------------ */
contract ProofOfFillTaker is ITakerCallbacks {
    event FillAttempted(bytes32 indexed strategyHash, address indexed maker, uint256 amountIn);
    event FillFailed(bytes32 indexed strategyHash, address indexed maker, bytes4 reason);

    Aqua    public immutable AQUA;
    address public immutable SWAPVM;
    address public immutable OWNER;

    modifier onlySwapVM() { require(msg.sender == SWAPVM, "not swapvm"); _; }

    constructor(Aqua aqua, address swapVM) { AQUA = aqua; SWAPVM = swapVM; OWNER = msg.sender; }

    /// @return honored true if the maker actually delivered
    function tryFill(
        ISwapVM.Order calldata order,
        uint256 amount,
        bytes calldata takerTraitsAndData,
        bytes32 strategyHash
    ) external returns (bool honored) {
        require(msg.sender == OWNER, "not owner");
        emit FillAttempted(strategyHash, order.maker, amount);

        try ISwapVM(SWAPVM).swap(order, amount, takerTraitsAndData) returns (uint256, uint256, bytes32) {
            honored = true;                 // upstream Swapped event is the receipt
        } catch (bytes memory reason) {
            bytes4 sel = reason.length >= 4 ? bytes4(reason) : bytes4(0);
            emit FillFailed(strategyHash, order.maker, sel);
            honored = false;                // NOTE: deliberately does NOT revert -> log survives
        }
    }

    function preTransferInCallback(
        address maker, address, address tokenIn, address,
        uint256 amountIn, uint256, bytes32 orderHash, bytes calldata
    ) public virtual onlySwapVM {
        IERC20(tokenIn).approve(address(AQUA), amountIn);
        AQUA.push(maker, SWAPVM, orderHash, tokenIn, amountIn);
    }

    function preTransferOutCallback(
        address, address, address, address, uint256, uint256, bytes32, bytes calldata
    ) public virtual onlySwapVM { }
}
