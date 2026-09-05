// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { SwapVM } from "@1inch/swap-vm/src/SwapVM.sol";
import { XYCSwapAquaTest } from "@1inch/swap-vm/test/XYCSwapAqua.t.sol";
import { ControlsAquaTest } from "@1inch/swap-vm/test/ControlsAqua.t.sol";
import { FeeAquaTest } from "@1inch/swap-vm/test/FeeAqua.t.sol";

import { ProofOfFillSwapVMRouter } from "../src/router/ProofOfFillSwapVMRouter.sol";

/// @notice THE regression proof for the 1inch bounty.
///
///         These suites are 1inch's OWN Aqua tests, imported unmodified from the pinned
///         the pinned 1inch swap-vm package. The only thing overridden is `_deployRouter()`, which
///         substitutes ProofOfFillSwapVMRouter for the stock AquaSwapVMRouter.
///
///         If appending ReputationGate (_21) or ReputationPriceAdjuster (_b3) disturbed
///         any official opcode, changed any pricing path, or altered any accounting
///         behaviour, these would fail. They are the evidence that our router is a
///         strict superset of the official one, not a fork.
contract PoF_XYCSwapAqua_Regression is XYCSwapAquaTest {
    function _deployRouter() internal override returns (SwapVM) {
        return new ProofOfFillSwapVMRouter(address(aqua), address(0), address(this), "SwapVM", "1.0.0");
    }
}

contract PoF_ControlsAqua_Regression is ControlsAquaTest {
    function _deployRouter() internal override returns (SwapVM) {
        return new ProofOfFillSwapVMRouter(address(aqua), address(0), address(this), "SwapVM", "1.0.0");
    }
}

contract PoF_FeeAqua_Regression is FeeAquaTest {
    function _deployRouter() internal override returns (SwapVM) {
        return new ProofOfFillSwapVMRouter(address(aqua), address(0), address(this), "SwapVM", "1.0.0");
    }
}
