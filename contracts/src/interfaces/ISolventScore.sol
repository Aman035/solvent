// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface ISolventScore {
    function scoreOf(address account) external view returns (uint32);
}
