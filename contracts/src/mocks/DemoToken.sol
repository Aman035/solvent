// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice DEMO-ONLY faucet token for the Base Sepolia deployment.
/// @dev Minting is deliberately open so a judge can run the demo without hunting for
///      testnet liquidity. Prior Aqua hackathon projects hit exactly this problem:
///      depending on a faucet is a good way to have a demo fail for a reason that has
///      nothing to do with the protocol. Never deploy this to a production chain.
contract DemoToken is ERC20 {
    uint8 private immutable _decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    /// @notice Anyone may mint. Demo only.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
