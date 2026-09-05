# Phase 0 — Verification Report

**Date:** 2026-09-05 · **Status:** V1, V2, V3, V10, V12 resolved · V9 partial · V4–V8, V11 outstanding

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

**Revert selector — RESOLVED empirically (see V10):** `SafeTransferFromFailed()` = **`0xf4059071`**, from `@1inch/solidity-utils/contracts/libraries/SafeERC20.sol`. 1inch's SafeERC20 *normalizes* the failure rather than bubbling the token's own error, so this selector is **stable and token-independent** — ideal for classification.

**Also found:** `SwapVM` already emits `Swapped(bytes32 orderHash, address maker, address taker, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut)` (`SwapVM.sol:242`). Like Aqua's events, none of its parameters are indexed.

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
| V11 Score design | C6 | Design drafted in BUILD_PLAN §V11 |


---

## V10 — Revert observability · **RESOLVED** ✅

Spike: `spike/SpikeRevertObservability.t.sol` — **5/5 pass.**

### Finding 1 — an honored fill needs no custom event

| Assertion | Result |
| --- | --- |
| B1: one `Swapped` + one `Pulled` + one `Pushed` per honored fill (6 logs total) | ✅ |

Upstream already emits everything the subgraph needs for the honored side. **`FillCompleted` is deleted from C8** — `Swapped` (router, carries maker/taker/amounts) joined to Aqua's `Pulled` (tokens actually leaving the maker's wallet) *is* the honored-fill record.

### Finding 2 — a broken promise reverts with a stable selector

| Assertion | Result |
| --- | --- |
| B2: under-funded maker at pull time reverts with **`0xf4059071` = `SafeTransferFromFailed()`** | ✅ |
| B3: **zero logs survive** that revert | ✅ |

### Finding 3 — router-level try/catch is IMPOSSIBLE

`SwapVM.sol` declares `_transferIn`, `_transferOut`, `_transferFrom`, `_transferOrPull` all **`private`**, and `swap()` is `external payable` but **not `virtual`**. Only `_dispatch` is `internal virtual`. So `handover_doc.md` §9.6 option 1 and BUILD_PLAN V10 option A (router catches the pull and emits) cannot be built without forking `SwapVM.sol` itself. A self-call wrapper is also ruled out: `ctx.query.taker` is hardcoded to `msg.sender`, so `address(this).swap(...)` would score the router instead of the taker.

### Finding 4 — THE DESIGN: the taker agent is a contract

**`ProofOfFillTaker` try/catches its own swap.** The outer transaction succeeds, so its logs survive and are natively indexable, while `msg.sender` to SwapVM remains the taker contract — keeping `ReputationGate`'s scoring target consistent.

| Assertion | Result |
| --- | --- |
| B4: failed fill → tx does **not** revert; `FillAttempted` + `FillFailed(selector)` both survive; no `Swapped` | ✅ |
| B5: honored fill → `honored == true`, `Swapped` emitted, no `FillFailed` | ✅ |

```solidity
try ISwapVM(SWAPVM).swap(order, amount, takerTraitsAndData) returns (uint256, uint256, bytes32) {
    honored = true;                       // upstream `Swapped` is the receipt
} catch (bytes memory reason) {
    emit FillFailed(strategyHash, order.maker, bytes4(reason));
    honored = false;                      // deliberately does NOT revert -> log survives
}
```

**One transaction. Fully on-chain. Natively indexable.** Strictly better than `handover_doc.md` §9.6's expected "option 2" (off-chain receipt scanning), which now becomes the *backstop* rather than the primary.

**Consequences for the build:**
- Bob is an on-chain **contract**, not only a script — a genuine upgrade to the pitch: *the taker agent records its own counterparty failures on-chain.*
- `ProofOfFillTaker` must implement `ITakerCallbacks` (`preTransferInCallback` pushes `tokenIn` into Aqua). B5 failed until this was added — a real integration trap now caught on day 0.
- **Caveat to document:** `SafeTransferFromFailed()` also occurs if the *taker* cannot pay. Disambiguate by reading the maker's balance at that block; the attestor's receipt-scan backstop cross-checks.
