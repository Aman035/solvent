// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface ISolventBook {
    function utilisationBps(address maker, address token) external view returns (uint32);
}
