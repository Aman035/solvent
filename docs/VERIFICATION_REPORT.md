# Phase 0 — Verification Report

**Date:** 2026-09-05 · **Status:** V1–V8, V10, V11, V12 resolved · V9 partial (needs deployer key + BaseScan/Anthropic keys) · **Phase 0 COMPLETE**

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
| V8 Deadlines | C28 | ✅ **Sun 13 Sep 2026, 21:30 IST / 16:00 UTC** · video ~4 min max · see `docs/SUBMISSION_CHECKLIST.md` |
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


---

## V6 — Subgraph Studio readiness · **GREEN** ✅

**The Graph prize's hard requirement — live data from a Graph provider on our target chain — is satisfiable and proven end to end.**

| Fact | Value |
| --- | --- |
| `base-sepolia` supported by Studio | **YES** |
| Studio account id | `42912` |
| Subgraph slug | `proof-of-fill` |
| Query endpoint shape | `https://api.studio.thegraph.com/query/42912/proof-of-fill/<version-label>` |
| graph-cli | `0.98.1` · graph-ts `0.38.1` |
| specVersion / apiVersion used | `1.0.0` / `0.0.7` |

**Pipeline proven:** a probe subgraph (`v0.0.1-probe`, indexing WETH `Transfer` at `0x4200…0006`) went `graph codegen` → `graph build` → `graph deploy` → **synced with `hasIndexingErrors: false`**, returning 125 real Base Sepolia entities.

**Latency — the number that governs the demo schedule:**

- Cold deploy over a 500-block backfill window: **synced in ~2–3 minutes.**
- Steady state: **2 blocks behind chain head** (≈4 s on Base).

This is far better than `handover_doc.md` §13's assumption that fills must be pre-run "30+ min before recording." A few minutes of buffer is ample. **R7 (Studio indexing lag during recording) drops from High to Low likelihood.** `demo:check`'s 50-block gate (C25) remains the right guard.

> **Note on "draft" status in Studio:** a subgraph shows *draft* until its first version is deployed. Resolved by the probe deploy.

**Two distinct Graph credentials are in use, both secret, both in `.env`:**
- `GRAPH_DEPLOY_KEY` — authenticates `graph deploy` against `api.studio.thegraph.com/deploy/`
- `GRAPH_API_KEY` — query key for the gateway


---

## V5 — ERC-8004 deployment status · **RESOLVED** ✅

### Registry availability, probed on-chain

| Registry | Base mainnet (8453) | Base Sepolia (84532) |
| --- | --- | --- |
| Identity `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | ✅ deployed | ❌ **no code** |
| Reputation `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | ✅ deployed | ❌ **no code** |
| Validation | not at a known canonical address | ❌ none |

Base-mainnet Identity is an **ERC-1967 proxy** → implementation `0x7274e874ca62410a93bd8bf61c69d8045e399c02`. Live probe confirms it is an ERC-721: `name() = "AgentIdentity"`, `symbol() = "AGENT"`, no `totalSupply()` (not Enumerable). Reputation's `owner()` = `0x547289319C3e6aedB179C0b8e8aF0B5ACd062603`.

### Decision

**C19 deploys the reference implementation to Base Sepolia ourselves.**

Source: **`ChaosChain/trustless-agents-erc-ri`** @ `2e5e79d` — the official ERC-8004 reference implementation. **CC0-1.0** (no attribution constraints), Solidity 0.8.19, 74/74 tests passing, v1.2.0 "Jan 2026 Spec Update". It contains all three registries, `ValidationRegistry.sol` included.

Its `deployments.json` shows the only live deployment is **Ethereum Sepolia** — Identity `0xf66e7CBd…37A7`, Reputation `0x6E2a2852…E407`, Validation `0xC26171A3…CA2C`. **Nothing on Base Sepolia.** This substantiates the pitch line: we would be among the Validation Registry's first real users, and the first on Base Sepolia.

### Exact signatures the subgraph (C13) and attestor (C17) consume

```solidity
// Identity
event Registered(uint256 indexed agentId, string agentURI, address indexed owner);
event URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy);
event AgentWalletSet(uint256 indexed agentId, address indexed newWallet, address indexed setBy);
event MetadataSet(uint256 indexed agentId, string indexed indexedMetadataKey, string metadataKey, bytes metadataValue);
function register(string calldata agentURI) external returns (uint256 agentId);
function getAgentWallet(uint256 agentId) external view returns (address wallet);

// Reputation  (note: int128 value + uint8 valueDecimals, NOT a uint8 score)
event NewFeedback(uint256 indexed agentId, address indexed clientAddress, uint64 feedbackIndex,
                  int128 value, uint8 valueDecimals, string indexed indexedTag1,
                  string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash);
event FeedbackRevoked(uint256 indexed agentId, address indexed clientAddress, uint64 indexed feedbackIndex);

// Validation  — TWO-STEP flow
event ValidationRequest (address indexed validatorAddress, uint256 indexed agentId,
                         string requestURI, bytes32 indexed requestHash);
event ValidationResponse(address indexed validatorAddress, uint256 indexed agentId, bytes32 indexed requestHash,
                         uint8 response, string responseURI, bytes32 responseHash, string tag);
```

**Two consequences for C17:**
1. The Validation flow is **request-then-respond**, not a single call. The attestor must create a `ValidationRequest` and then a `ValidationResponse` keyed by `requestHash`.
2. `response` is a `uint8` (natural fit for HONORED / FAILED) and `tag` is a free `string` — so the **fill txHash goes in `tag`**, with the full JSON attestation behind `responseURI` (`data:` URI) and committed via `responseHash`.

**Open (non-blocking, resolve during C17):** whether `validationRequest` is permissioned to a registered validator.

**Note:** `getAgentWallet(agentId)` exists natively, so `ReputationRegistryAdapter` (C8) can resolve `agentId → wallet` directly rather than parsing metadata.


---

## V4 — SDK audit · **RESOLVED** ⚠️ (with a consequential finding)

### The published TypeScript SDK is out of sync with the contracts

`@1inch/swap-vm-sdk@0.4.1` and `@1inch/aqua-sdk@0.3.1` exist on npm (the *contract* packages `@1inch/swap-vm` / `@1inch/aqua` do not — they are GitHub deps).

`AquaProgramBuilder` exposes typed builders (`xycSwapXD`, `deadline`, `flatFeeAmountInXD`, `extruction`, …) and `ProgramBuilder(ixsSet)` takes its instruction set as a **constructor argument**, so the set is injectable in principle. But `add(ix)` validates against that set and `decode()` indexes it **by opcode byte** — and the SDK's bytes do not match the current contracts:

| Instruction | SDK 0.4.1 emits | `main` `OpcodeList.sol` expects |
| --- | --- | --- |
| `XYCSwap` | `0x11` | **`0x50`** |
| `Deadline` | `0x0d` | **`0x20`** |
| `Extruction` | `0x20` | **`0x04`** |

Verified by building real programs: `xycSwapXD()` → `0x1100`, `deadline(9999)` → `0x0d05000000270f`.

### Root cause: released tags use a legacy opcode layout

| Ref | `src/libs/OpcodeList.sol` | Layout |
| --- | --- | --- |
| `main` @ `f09a41e` (2026-09-03) | present | **banked 0x00–0xff, reserved free slots** |
| `v1.0.2` @ `32c687c` | absent | legacy sequential |
| `v1.0.1` @ `b6e4f97` | absent | legacy sequential |
| `v1.0.0`, `0.0.6` | absent | legacy sequential |

The banked opcode space — the thing that makes `ReputationGate` a clean, index-safe append — **exists only on `main`**. Every published tag, and the SDK that matches them, predates it.

### DECISION: build against `main` @ `f09a41e` (pinned SHA), hand-encode programs

**Rationale:**
1. The entire 1inch story is "define your own instruction." `main`'s `OpcodeList.sol` documents that workflow explicitly (*"For new instructions take the next free `_Ix` slots of their family bank"*) and reserves the slots for it. On a legacy tag we would be appending to a sequential enum with no such affordance — a materially weaker and riskier story.
2. The V1 spike is already green on `main` (6/6), as is the V10 spike (5/5).
3. Hand-encoding is cheap: the format is `[opcode:1][argsLen:1][args]` (`ContextLib.runLoop`), and the Solidity `InstructionBuilder` gives an exact reference to test against.

**Consequences:**
- **C9 hand-encodes.** The SDK cannot be used to build programs for our router — this would have surfaced as baffling `UnknownOpcode` reverts on day 5.
- C9's round-trip test (TS encode → Solidity decode) is now *load-bearing*, not a nicety.
- Pin the exact SHA `f09a41e689240adc645934f965c8061749397cd2` everywhere; record it in `docs/DEVIATIONS.md` with this rationale.
- The `aqua-sdk` event decoders (`ShippedEvent`, `PulledEvent`, `PushedEvent`, `DockedEvent`) and `SwappedEvent` remain usable for **off-chain decoding** — they are ABI-driven, not opcode-dependent.


---

## V7 — Prior art · **RESOLVED** ✅

Read for *pattern only*; no code copied (Start Fresh compliance — see `docs/DEVIATIONS.md`).

### Votive (`resistingdestiny/wishing-well-votive` @ `a41a455`)

**They appended 7 custom opcodes** (`VOTIVE_OPCODE_COUNT = 7`) via a `VotiveOpcodes` mixin and a `VotiveAquaRouter is AquaSwapVMRouter, VotiveOpcodes`. So a custom-instruction submission has precedent and was accepted.

**Crucially, they used a different extension API than we do — which independently confirms V4.** Votive overrides **`_opcodes()`** (a table-copy-and-append), whereas current `main` uses **`_runOpcode()`** (an `if/else` dispatch with `super` fallthrough). Their own comment describes appending to indices *"which are `_notInstruction` on the stock router"* — the **legacy sequential** layout. `main`'s banked `OpcodeList.sol` with named reserved slots per family bank did not exist yet.

**Honest trade-off this exposes:** on the legacy layout Votive kept SDK compatibility (*"a program encoded by the Aqua SDK … runs byte-identically here"*). By building on `main` we give that up and hand-encode (C9). We gain the reserved-slot design that makes `ReputationGate` an index-safe, idiomatic append rather than a sequential tack-on — a materially stronger 1inch story. **V4's decision stands.**

### Patterns to adopt

1. **`new Aqua()` takes no constructor arguments.** C5 is genuinely trivial. (Note `main`'s `AquaSwapVMRouter` now takes **5** args — `aqua, weth, owner, name, version` — versus the 3 Votive used, another confirmation `main` has moved.)
2. **Deploy our own mock tokens rather than hunting testnet WETH/USDC.** Votive's rationale is exactly right: *"depending on a faucet for testnet tokens is a good way to have a demo fail for a reason that has nothing to do with the protocol."* **Adopted** — C2 will deploy `TokenMock` WETH/USDC, removing a whole class of demo-day risk (R5).
3. Deploy a `MockTaker`-style helper alongside, as we already plan with `ProofOfFillTaker` (C20).

### ArcBook (`Ryad2/liquid_OB` @ `9039b86`)

Redeploys Aqua + `AquaSwapVMRouter` and has a clean script layout (`DeployLiquidOB`, `SeedDemoPositions`, `DockDemoPositions`, `ReplayDemoRoute`) worth mirroring in C25's orchestration. **No custom opcode** — it consumes the stock router.

**Conclusion:** nobody in the prior art scores Aqua makers, and no one has combined a custom SwapVM instruction with ERC-8004. The differentiator in `handover_doc.md` §5 holds.
