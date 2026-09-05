// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Vm } from "forge-std/Vm.sol";
import { AquaSwapVMTest } from "./base/AquaSwapVMTest.sol";
import { ISwapVM } from "../src/interfaces/ISwapVM.sol";
import { ProofOfFillTaker } from "../spike/ProofOfFillSpike.sol";

/// @notice V10 SPIKE — how does a broken promise become indexable data?
contract SpikeRevertObservabilityTest is AquaSwapVMTest {
    // upstream event signatures we expect to be able to index
    bytes32 constant SWAPPED_SIG = keccak256("Swapped(bytes32,address,address,address,address,uint256,uint256)");
    bytes32 constant PULLED_SIG  = keccak256("Pulled(address,address,bytes32,address,uint256)");
    bytes32 constant PUSHED_SIG  = keccak256("Pushed(address,address,bytes32,address,uint256)");
    bytes32 constant SHIPPED_SIG = keccak256("Shipped(address,address,bytes32,bytes)");

    function _setup() internal pure returns (MakerSetup memory) {
        return MakerSetup({
            balanceA: INITIAL_BALANCE_A, balanceB: INITIAL_BALANCE_B,
            priceMin: 0, priceMax: 0, protocolFeeBps: 0, feeInBps: 0,
            protocolFeeRecipient: address(0), swapType: SwapType.XYC
        });
    }

    function _prog(uint256 amt) internal view returns (SwapProgram memory) {
        return SwapProgram({
            amount: amt, taker: taker, tokenA: tokenA, tokenB: tokenB,
            zeroForOne: true, isExactIn: true
        });
    }

    function _count(Vm.Log[] memory logs, bytes32 sig) internal pure returns (uint256 n) {
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics.length > 0 && logs[i].topics[0] == sig) n++;
        }
    }

    // ---------------------------------------------------------------
    // B1 — an HONORED fill is already fully described by upstream events
    // ---------------------------------------------------------------
    function test_B1_HonoredFillEmitsUpstreamEvents() public {
        MakerSetup memory s = _setup();
        ISwapVM.Order memory order = createStrategy(s);
        shipStrategy(order, tokenA, tokenB, s.balanceA, s.balanceB);

        SwapProgram memory p = _prog(100e18);
        mintTokenInToTaker(p);
        mintTokenOutToMaker(p, 200e18);   // maker CAN deliver

        vm.recordLogs();
        swap(p, order);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(_count(logs, SWAPPED_SIG), 1, "expected exactly one Swapped");
        assertEq(_count(logs, PULLED_SIG),  1, "expected exactly one Pulled");
        assertEq(_count(logs, PUSHED_SIG),  1, "expected exactly one Pushed");
        emit log_named_uint("total logs in honored fill", logs.length);
    }

    // ---------------------------------------------------------------
    // B2 — a maker who cannot deliver: capture the exact revert
    // ---------------------------------------------------------------
    function test_B2_UnderfundedMakerRevertSelector() public {
        MakerSetup memory s = _setup();
        ISwapVM.Order memory order = createStrategy(s);
        shipStrategy(order, tokenA, tokenB, s.balanceA, s.balanceB);

        SwapProgram memory p = _prog(100e18);
        mintTokenInToTaker(p);
        // NOTE: deliberately NOT minting tokenOut to maker -> phantom liquidity

        bytes memory td = abi.encodePacked(takerData(address(taker), true, true));

        bool reverted;
        bytes memory ret;
        try taker.swap(order, p.amount, td) returns (uint256, uint256) {
            reverted = false;
        } catch (bytes memory reason) {
            reverted = true;
            ret = reason;
        }

        assertTrue(reverted, "swap should have reverted: maker cannot deliver");
        emit log_named_uint("revert data length", ret.length);
        emit log_named_bytes("raw revert data", ret);
        require(ret.length >= 4, "no selector in revert data");
        emit log_named_bytes32("revert selector", bytes32(uint256(uint32(bytes4(ret))) << 224));
    }

    // ---------------------------------------------------------------
    // B3 — THE CONSTRAINT: logs do not survive a revert
    // ---------------------------------------------------------------
    function test_B3_LogsDoNotSurviveRevert() public {
        MakerSetup memory s = _setup();
        ISwapVM.Order memory order = createStrategy(s);
        shipStrategy(order, tokenA, tokenB, s.balanceA, s.balanceB);

        SwapProgram memory p = _prog(100e18);
        mintTokenInToTaker(p);
        // maker cannot deliver

        bytes memory td = abi.encodePacked(takerData(address(taker), true, true));

        vm.recordLogs();
        bool reverted;
        try taker.swap(order, p.amount, td) returns (uint256, uint256) {
            reverted = false;
        } catch { reverted = true; }
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertTrue(reverted, "expected revert");
        assertEq(_count(logs, SWAPPED_SIG), 0, "Swapped must NOT survive a revert");
        assertEq(_count(logs, PULLED_SIG),  0, "Pulled must NOT survive a revert");
        emit log_named_uint("logs surviving the failed fill", logs.length);
    }

    // ---------------------------------------------------------------
    // B4 — THE DESIGN: taker-contract try/catch makes failure indexable
    // ---------------------------------------------------------------
    bytes32 constant FILL_FAILED_SIG    = keccak256("FillFailed(bytes32,address,bytes4)");
    bytes32 constant FILL_ATTEMPTED_SIG = keccak256("FillAttempted(bytes32,address,uint256)");

    function test_B4_TakerContractMakesFailureIndexable() public {
        MakerSetup memory s = _setup();
        ISwapVM.Order memory order = createStrategy(s);
        bytes32 sh = shipStrategy(order, tokenA, tokenB, s.balanceA, s.balanceB);

        ProofOfFillTaker pofTaker = new ProofOfFillTaker(aqua, address(swapVM));
        tokenA.mint(address(pofTaker), 100e18);
        vm.prank(address(pofTaker));
        tokenA.approve(address(swapVM), type(uint256).max);
        // maker deliberately holds no tokenB -> cannot deliver

        bytes memory td = abi.encodePacked(takerData(address(pofTaker), true, true));

        vm.recordLogs();
        bool honored = pofTaker.tryFill(order, 100e18, td, sh);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertFalse(honored, "maker could not deliver, so honored must be false");
        assertEq(_count(logs, SWAPPED_SIG),        0, "no Swapped on a failed fill");
        assertEq(_count(logs, FILL_ATTEMPTED_SIG), 1, "FillAttempted must survive");
        assertEq(_count(logs, FILL_FAILED_SIG),    1, "FillFailed must survive -> INDEXABLE");
        emit log_named_uint("logs surviving (tx did NOT revert)", logs.length);
    }

    function test_B5_TakerContractHonoredPath() public {
        MakerSetup memory s = _setup();
        ISwapVM.Order memory order = createStrategy(s);
        bytes32 sh = shipStrategy(order, tokenA, tokenB, s.balanceA, s.balanceB);

        ProofOfFillTaker pofTaker = new ProofOfFillTaker(aqua, address(swapVM));
        tokenA.mint(address(pofTaker), 100e18);
        vm.prank(address(pofTaker));
        tokenA.approve(address(swapVM), type(uint256).max);
        tokenB.mint(maker, 200e18);   // maker CAN deliver

        bytes memory td = abi.encodePacked(takerData(address(pofTaker), true, true));

        vm.recordLogs();
        bool honored = pofTaker.tryFill(order, 100e18, td, sh);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertTrue(honored, "maker could deliver");
        assertEq(_count(logs, SWAPPED_SIG),        1, "Swapped is the honored receipt");
        assertEq(_count(logs, FILL_ATTEMPTED_SIG), 1, "FillAttempted present");
        assertEq(_count(logs, FILL_FAILED_SIG),    0, "no FillFailed on success");
    }
}
