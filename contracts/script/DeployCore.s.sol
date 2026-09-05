// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script } from "forge-std/Script.sol";
import { console } from "forge-std/console.sol";

import { Aqua } from "@1inch/aqua/src/Aqua.sol";

import { ProofOfFillScore } from "../src/ProofOfFillScore.sol";
import { ProofOfFillSwapVMRouter } from "../src/router/ProofOfFillSwapVMRouter.sol";
import { DemoToken } from "../src/mocks/DemoToken.sol";

/// @notice Deploys the Proof-of-Fill core stack.
///
/// @dev Aqua is deployed from the pinned, UNMODIFIED official source
///      (1inch/aqua @ 9c5c42e). Official Aqua deployments are mainnet-only, so a
///      redeploy is the documented way to use it on Base Sepolia.
///
///      The router is the official AquaSwapVMRouter shape with two appended
///      instructions - the "redeployment of a modified SwapVM" the bounty permits.
contract DeployCore is Script {
    function run() external {
        address deployer = msg.sender;
        address attestor = vm.envAddress("ATTESTOR_ADDRESS");

        vm.startBroadcast();

        Aqua aqua = new Aqua();
        ProofOfFillScore score = new ProofOfFillScore(deployer, attestor);
        ProofOfFillSwapVMRouter router =
            new ProofOfFillSwapVMRouter(address(aqua), address(0), deployer, "ProofOfFillSwapVM", "1.0.0");

        DemoToken weth = new DemoToken("Proof of Fill WETH", "pofWETH", 18);
        DemoToken usdc = new DemoToken("Proof of Fill USDC", "pofUSDC", 6);

        vm.stopBroadcast();

        // NOTE: do NOT use console.log("%s", addr) - forge fails to decode the
        // address during broadcast ("type check failed for offset (usize)").
        console.log("AQUA");
        console.logAddress(address(aqua));
        console.log("SCORE");
        console.logAddress(address(score));
        console.log("ROUTER");
        console.logAddress(address(router));
        console.log("WETH");
        console.logAddress(address(weth));
        console.log("USDC");
        console.logAddress(address(usdc));
    }
}
