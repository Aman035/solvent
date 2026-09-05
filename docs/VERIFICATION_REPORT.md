# Phase 0 — Verification Report

**Date:** 2026-09-05 · **Status:** V1/V2/V3/V12 resolved · V4–V11 outstanding

Pinned upstream commits used for all findings below:

| Repo | Commit | Date | Latest tag |
| --- | --- | --- | --- |
| `1inch/swap-vm` | `f09a41e689240adc645934f965c8061749397cd2` | 2026-09-03 | `v1.0.1` |
| `1inch/aqua` | `9c5c42e5840e8741fba3597c48456c9510212b66` | 2026-08-21 | `v1.0.0` |

Toolchain: forge 1.5.1-stable · node v23.7.0 · pnpm 9.15.3 · solc 0.8.30 (optimizer 700, `via_ir = true`).

---

## V1 — SwapVM opcode extensibility · **GREEN** ✅

**Outcome: clean append. No upstream source modification required. No opcode index shifting is even possible.**

Three independent facts establish this:

**1. The opcode space pre-reserves free slots.** `src/libs/OpcodeList.sol` is a 256-entry enum banked by instruction family, where every unallocated index is an explicit named placeholder (`_05`, `_21`, `_27`…). The file carries the convention verbatim: *"For new instructions take the next free `_Ix` slots of their family bank."* Because placeholders already occupy every index, adding an instruction cannot renumber an existing one.

Bank `0x20-0x3f` is documented as *"Conditions & access guards: taker/time validation, whitelists, conditional jumps"* — exactly where a reputation gate belongs. We take **`_21` (0x21)**, the first free slot after `Deadline` (0x20).

**2. Dispatch is `internal virtual`, and 1inch ships a reference extension.** `AquaOpcodes._runOpcode(...)` is `virtual`, and upstream's own `AquaOpcodesDebug` extends it with the exact pattern we need:

```solidity
contract AquaOpcodesDebug is AquaOpcodes {
    function _runOpcode(Context memory ctx, uint256 opcode, bytes calldata args) internal override {
        if (opcode == PrintSwapRegisters.opcode.asU8()) PrintSwapRegisters.exec(ctx, args);
        else super._runOpcode(ctx, opcode, args);   // ← fallthrough to upstream
    }
}
```

`ProofOfFillOpcodes is AquaOpcodes` + `ProofOfFillSwapVMRouter is Simulator, SwapVM, ProofOfFillOpcodes` is therefore not a fork or a hack — it is upstream's documented house pattern for adding instructions.

**3. Proven by a working spike.** `spike/ProofOfFillSpike.sol` implements a real `ReputationGate` instruction; `spike/SpikeReputationGate.t.sol` runs against a genuine Aqua-shipped strategy. **6/6 pass:**

| # | Assertion | Result |
| --- | --- | --- |
| A1 | Upstream opcode indices unchanged (`Deadline` 0x20, `XYCSwap` 0x50, `FeeFlatIn` 0x70, `Extruction` 0x04); gate at reserved 0x21 | ✅ |
| A2 | Ungated stock program on our router reproduces the exact upstream XYC formula | ✅ |
| A3 | Gate is price-neutral for a taker at/above the floor | ✅ |
| A4 | Gate refuses a below-floor taker in the **swap** path with correct custom-error args | ✅ |
| A5 | Gate refuses a below-floor taker in the **static quote** path | ✅ |
| A6 | Quote succeeds and prices correctly for a qualified taker | ✅ |

**Consequence for C7:** build the real instruction as planned, at `Opcode._21`. No fallback needed.

### Bonus finding — a second, zero-fork path exists

`Opcode.Extruction` (0x04) is an official extension point that delegates `SwapQuery` + `SwapRegisters` to a maker-chosen external contract, with separate `view` (quote) and non-view (swap) interfaces. It can modify registers, move the program counter, and revert.

This means **`ReputationGate` can also ship against 1inch's *official, unmodified* SwapVM deployment via `Extruction`, with no redeploy at all.** We build the native opcode (it scores higher with 1inch and is the cleaner design), and cite the Extruction path in the README as the production adoption route. This is a strong argument for the 1inch DAO Aqua Incubator follow-up.

---

## V3 — SwapVM execution context · **RESOLVED** ✅

**The taker IS available, in both paths, and the pitch claim "enforce at quote time" is TRUE.**

- `SwapQuery { bytes32 orderHash; address maker; address taker; address tokenIn; address tokenOut; bool isExactIn; }` — read as `ctx.query.taker`.
- **`SwapVM.sol:149` (quote) and `SwapVM.sol:203` (swap) both set `taker: msg.sender`.** The `taker` field in `TakerTraits` does *not* feed `query.taker`.
- `ctx.vm.isStaticContext` distinguishes quote from swap.
- Mutable registers for price adjustment: `ctx.swap.{balanceIn, balanceOut, amountIn, amountOut}`.

**Security implication (good):** because taker identity is `msg.sender`, a taker cannot spoof it to pass the gate.

**Limitation to document in `TRUST_ASSUMPTIONS.md`:** if a taker routes through an aggregator or smart-contract wallet, `msg.sender` is that contract, so the score checked is the contract's, not the end user's. Upstream has the same property (hence their weaker `OnlyTxOriginTokenBalanceNonZero` alternative).

**Program encoding** (feeds C9): `[opcode:1][argsLen:1][args:argsLen]`, parsed in `ContextLib.runLoop`. Hand-encoding is trivial; builder helpers are `InstructionBuilder` + `MemoryPtr` + `InstructionArgs`.

---

## V12 — Static-context constraint · **RESOLVED** ✅

A validation-only instruction runs safely under `staticcall` and may revert there (A5 proves it). It must not emit events or write state, so `FillAttempted`/`FillCompleted`/`FillFailed` belong in the **router's swap path**, not in the instruction.

`Strategies.sol` maintains a `_prefixBitmap` of *"validation-only opcodes which do not change registers"* permitted as on-chain order prefixes. This confirms the C7 design split:

- **`ReputationGate` (0x21, guards bank)** — pure refuse/allow, touches no registers, prefix-safe.
- **Price widening must be a separate instruction** in the rates bank (`0xb0-0xcf`, e.g. free slot `_b3`), modelled on `BaseFeeAdjuster`/`OraclePriceAdjuster`.

This is *more* idiomatic to 1inch's architecture than the single combined instruction in `handover_doc.md` §9.2, and yields two custom instructions rather than one.

---

## V2 — Aqua contract surface · **MOSTLY RESOLVED** 🟡

**Events** (all declared in `src/interfaces/IAqua.sol`):

```solidity
event Shipped(address maker, address app, bytes32 strategyHash, bytes strategy);
event Docked (address maker, address app, bytes32 strategyHash);
event Pulled (address maker, address app, bytes32 strategyHash, address token, uint256 amount);
event Pushed (address maker, address app, bytes32 strategyHash, address token, uint256 amount);
```

⚠️ **No parameters are `indexed`.** The subgraph must index all events and filter in mapping code; no topic-level filtering by maker is possible.

`Pulled` = tokens leaving the maker's wallet = **the honored-fill signal**. `Pushed` = taker paying in.

**API:** `ship(app, strategy, tokens[], amounts[]) → strategyHash` · `dock(app, strategyHash, tokens[])` · `pull(maker, strategyHash, token, amount, to)` · `push(maker, app, strategyHash, token, amount)` · views `rawBalances(...)` and `safeBalances(maker, app, strategyHash, token0, token1)`.

**Confirmed mechanics:** `strategy = abi.encode(order)`, and `strategyHash == swapVM.hash(order)`. **The maker approves Aqua, not the router.** Virtual balances are publicly readable → the dashboard's "never deposited" line is directly supported.

**Resolver restriction:** none found in Aqua's source — no access-control errors, no allowlist. It appears to be a router-level or off-chain 1inch policy, so our unmodified Aqua redeploy should be unrestricted. *Still to confirm against the router before C5 (does not block).*

**Outstanding:** the concrete revert selector when `pull` finds an under-funded maker. It bubbles the token's own `transferFrom` failure (e.g. OZ `ERC20InsufficientBalance(address,uint256,uint256)`), so it is token-dependent — pin it empirically in C10.

---

## V9 — Toolchain · **PARTIAL** 🟡

✅ forge 1.5.1 · node v23.7.0 · pnpm 9.15.3 · npm 11.2.0 · git 2.50.1 · jq · curl. Network to github + npm OK.
❌ `graph-cli` not installed (needed before V6).
⚠️ **Disk at 94% (14 GiB free)** — watch it; `via_ir` builds and node_modules are heavy.
⚠️ **`forge build` takes 5m10s cold** because `via_ir = true`. Use a non-via-IR dev profile for iteration and reserve via-IR for deploy/verify builds.

---

## Outstanding

| Check | Blocker for | Notes |
| --- | --- | --- |
| V4 SDK audit | C9 | Program bytes are simple; hand-encoding is viable regardless |
| V5 ERC-8004 status | C19 | Needs network calls |
| V6 Studio readiness | C13/C14 | **Hard gate on the Graph prize** — needs account + API key |
| V7 Prior art | C5 | Low risk |
| V8 Deadlines | C28 | Needs ETHGlobal dashboard |
| V10 Revert observability | C15 | Design chosen; needs empirical test |
| V11 Score design | C6 | Design drafted in BUILD_PLAN §V11 |
