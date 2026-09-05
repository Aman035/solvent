# ERC-8004 reference implementation artifacts

Compiled from **ChaosChain/trustless-agents-erc-ri @ `2e5e79d`** (v1.2.0, "Jan 2026 Spec
Update"), licence **CC0-1.0**, using that repository's own toolchain:
solc **0.8.19**, optimizer on (200 runs), `via_ir = true`, OpenZeppelin **v4**.

They are vendored as artifacts rather than source because the reference implementation
pins `pragma solidity 0.8.19` and uses OpenZeppelin v4 import paths
(`security/ReentrancyGuard`, `utils/Counters`), both incompatible with this project's
solc 0.8.30 / OZ 5.4 build. **Nothing in the reference implementation was modified** -
see `docs/DEVIATIONS.md`.

Deployed because V5 established that no ERC-8004 registry exists on Base Sepolia; the
canonical Identity/Reputation addresses are live on Base *mainnet* only, and no
Validation Registry has a confirmed deployment anywhere.
