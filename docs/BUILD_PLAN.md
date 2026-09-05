# Proof of Fill — Build Plan

> **Supersedes:** the execution sections of `handover_doc.md` (§8–§15). That document remains the source of truth for **why** (§1–§7, §16, §17) and for the **partner rubrics** (§1.1, §12). This document is the source of truth for **what gets built, in what order, and how each piece is proven correct.**
>
> **Posture:** maximum ambition. Nothing is cut. Where this plan differs from `handover_doc.md` it is by *addition* or *reordering to reduce integration risk* — never by descoping.
>
> **Start:** Sept 5, 2026. **Submission target:** Sept 13, 2026. **Hard deadline:** Sept 16, 2026.
> **Partners:** 1inch (Build an Aqua App) · The Graph (Best AI Use Case, From Scratch).

---

## 0. How this document works

Every component below has exactly five fields. No component is "done" until its **Verification** block passes as a command.

| Field | Meaning |
| --- | --- |
| **Goal** | Why this exists. One sentence. If you can't say it, don't build it. |
| **Depends on** | Hard prerequisites. Never start a component with an unmet dependency. |
| **Risk** | `LOW` / `MED` / `HIGH` / `GATE`. `GATE` means the project's shape changes if it fails. |
| **Plan** | Ordered, concrete build steps. |
| **Verification** | A runnable command and the exact conditions under which it passes. |

### 0.1 The verification harness (build this first — see C3)

Every component gets a verification script. They aggregate:

```bash
pnpm verify:v1        # a single Phase-0 check
pnpm verify:c7        # a single component
pnpm verify:contracts # a phase
pnpm verify:all       # everything → writes docs/VERIFICATION_REPORT.md
```

`pnpm verify:all` emits a table of component / status / evidence (tx hash, test count, URL) and exits non-zero if anything regressed. This is what you screenshot for judges, and it is what tells you at 2am on day 7 whether the thing you just changed broke the demo.

### 0.2 Build strategy: vertical slice before depth

`handover_doc.md` §9 builds each component to completion before moving to the next. That finds integration breaks late, and integration is where multi-system hackathon projects actually die — four systems that each work alone and don't work together at hour 60.

**This plan inverts that.** Day 3 is a deliberately ugly end-to-end path: ship → fill → event → minimal subgraph → score → swap. No gate, no LLM, no dashboard, no attestor service. Once bytes flow end to end, every subsequent component is an upgrade to a working system rather than a new integration risk.

```
Phase 0  Verify & spike        ── prove the unknowns before committing
Phase 1  Foundations           ── repo, funding, manifest, CI, verify harness
Phase 2  Contracts             ── Aqua, 8004, score, opcode, router, encoder
Phase 3  ★ VERTICAL SLICE ★    ── ugly end-to-end; the integration gate
Phase 4  Data                  ── full subgraph, failed-fill pipeline, score lib
Phase 5  Services & agents     ── attestor, Alice, Mallory, Bob, LLM layer
Phase 6  Adversarial           ── cost-to-fake harness, score simulator
Phase 7  Surface               ── dashboard
Phase 8  Delivery              ── orchestration, docs, video, submission
```

### 0.3 Commit discipline (a 1inch qualification requirement)

1inch explicitly checks git history and disqualifies single-commit final-day dumps. Therefore:

- `git init` and first commit **today**, before any real code.
- Commit at every passing acceptance criterion, minimum ~6–10 commits/day.
- Conventional prefixes: `feat(gate):`, `test(subgraph):`, `fix(attestor):`, `docs:`, `chore:`.
- Never rebase or squash. The messy history *is* the evidence.
- Push to a public GitHub repo from day 1 (The Graph requires open source anyway).

---

## 1. Phase 0 — Verification & spikes

**Do all of Phase 0 before writing production code.** Timebox: today (Sept 5). Write findings into `docs/VERIFICATION_REPORT.md` as you go — this file is a deliverable, not a scratchpad.

`handover_doc.md` §14 lists 8 checks. This adds V9–V12 and sharpens the exit criteria on all of them.

---

### V1 — SwapVM opcode extensibility spike  ·  **RISK: GATE**

**Goal:** Determine — in hours, not days — whether a new instruction can be appended to SwapVM without breaking upstream opcode indices. This single answer determines whether the 1inch prize story is "custom opcode" (strong) or "forked router" (acceptable) or "no gate" (project reshapes).

**Plan:**
1. Clone `1inch/swap-vm` at a pinned tag/commit. Record the commit SHA in the report.
2. `forge build`. Resolve toolchain issues now, not on day 2.
3. Locate the instruction dispatch mechanism. Read in this order: `src/libs/VM.sol` → `src/routers/AquaSwapVMRouter.sol` → `src/instructions/Controls.sol` → `src/instructions/Fee.sol`. Answer explicitly: is dispatch a `switch` on an opcode byte, a jump table, a function-pointer array, or a bitmask of enabled instructions?
4. Write `test/SpikeStockProgram.t.sol`: build the simplest possible XYCSwap program, call `quote()`, assert a concrete output amount. **This is the baseline.**
5. Add a trivial `Noop` instruction at the next free opcode index. Redeploy the router in-test.
6. Assert both: (a) the stock program from step 4 produces a **byte-identical** quote on the modified router; (b) a program with `Noop` prepended also produces the identical quote.

**Verification:** `forge test --match-path test/SpikeStockProgram.t.sol -vvv`

Record one of three outcomes in the report:
- [ ] **GREEN** — clean append works. Proceed with `ReputationGate` as a real instruction (C7).
- [ ] **AMBER** — requires forking the router and inlining the check. Still qualifies as "modified SwapVM redeployed." Proceed to C7 with the fork approach; note the change in the README.
- [ ] **RED** — cannot modify pricing/flow from an instruction at all. Escalate immediately: fall back to a wrapper contract in front of the router that enforces the gate before delegating. Weaker for 1inch; the project still stands.

**Timebox: 4 hours.** If unresolved at 4 hours, declare AMBER and move on. Do not let this consume day 0.

---

### V2 — Aqua contract surface  ·  **RISK: HIGH**

**Goal:** Know the exact events the subgraph will index and the exact revert behaviour that constitutes a "broken promise," because both the data layer and the entire pitch depend on them.

**Plan:** Read `1inch/aqua/src/Aqua.sol` and answer, with line references:
1. Exact event signatures for ship / dock / pull / push — names, parameter types, **which parameters are indexed**.
2. Does `ship` emit the `strategyHash`, or must it be computed off-chain? If computed, what is the exact preimage?
3. The `pull` failure path: what is the revert selector when the maker's wallet lacks tokens? Is it Aqua's own error, an ERC20 `transferFrom` failure, or a bare revert? **Capture the exact 4-byte selector** — C15's failed-fill classifier needs it.
4. Where does the resolver/KYC restriction live — Aqua, the router, or both? Can our redeploy drop it, and does dropping it require modifying Aqua (which would break the "official unmodified bytecode" claim)?
5. Are virtual balances readable via a public view function? The dashboard's "never deposited" line needs this.

**Verification:** `docs/VERIFICATION_REPORT.md` §V2 contains all five answers with file:line citations and the literal revert selector as a hex string.

**Critical branch:** if the resolver restriction lives in **Aqua** rather than the router, we cannot both use unmodified Aqua bytecode *and* have an unrestricted taker. Decide and document: either modify Aqua (and drop the "official bytecode" claim to "official source, one documented modification"), or keep it and register our taker as a resolver on our own deploy.

---

### V3 — SwapVM execution context  ·  **RISK: GATE**

**Goal:** Establish whether `ReputationGate` can actually see the taker's address, and whether it can see it at **quote** time or only at **swap** time. The pitch says "makers enforce the score at quote time" — this check decides whether that sentence is true.

**Plan:**
1. In `VM.sol`, find the context struct passed to each instruction. The audit describes `SwapQuery{maker, taker, tokenIn, tokenOut, isExactIn}` — confirm the real field names.
2. **Answer the critical question:** does `quote()` accept or propagate a taker address? Many quoting paths are taker-agnostic by design. If `quote()` has no taker, the gate can only enforce in `swap()`.
3. Read `Fee.sol` closely: how does it mutate the output amount? Which registers are mutable? How does it branch on `isExactIn` vs exact-out? `ReputationGate`'s price-widening must mirror this exactly.
4. Confirm instructions can `revert` safely in a `staticcall` quote context.
5. Confirm what an instruction may emit. Events in a static context are not possible — this constrains C7's `FillAttempted` design and feeds V12.

**Verification:** `docs/VERIFICATION_REPORT.md` §V3 answers all five, plus a one-paragraph design note: *"ReputationGate will read the taker from `<field>` and widen price by mutating `<register>` following the pattern at `Fee.sol:<line>`."*

**If quote() is taker-agnostic:** the gate enforces at swap time only. Update the pitch language everywhere (README, video script §15, dashboard copy) from "refuses at quote time" to "refuses at execution." Do not ship a claim the code doesn't support — a judge who reads the contract will catch it.

---

### V4 — SDK capability audit  ·  **RISK: MED**

**Goal:** Know whether `@1inch/swap-vm-sdk` can encode a program containing a custom opcode, or whether we hand-roll the encoder (C10).

**Plan:**
1. `npm view @1inch/swap-vm-sdk versions` and `@1inch/aqua-sdk`. Pin exact versions.
2. Install both in a scratch project; dump exports (`Object.keys`) for: `Order`, `MakerTraits`, `AquaAMMStrategy`, `AQUA_SWAP_VM_CONTRACT_ADDRESSES`, `AquaProtocolContract`, `AQUA_CONTRACT_ADDRESSES`.
3. Determine: is the instruction set an open enum/registry the SDK will encode arbitrary opcodes for, or a closed union that rejects unknown instructions?
4. Encode a stock XYCSwap program with the SDK; encode the same program by hand; assert byte equality. **This is the round-trip baseline for C10.**
5. Confirm the SDK's strategy-hash computation matches the contract's.

**Verification:** `pnpm verify:v4` — a script that encodes a known program via SDK and by hand and asserts byte-identical output, printing both hex strings.

---

### V5 — ERC-8004 deployment status  ·  **RISK: HIGH**

**Goal:** Know whether the three registries exist on Base Sepolia or whether we deploy them, because C5's size differs by a factor of five between those cases.

**Plan:**
1. Read EIP-8004. Extract exact function and event signatures for Identity, Reputation, and Validation registries into the report — the subgraph and attestor both consume these verbatim.
2. Check the canonical mainnet addresses from `handover_doc.md` §2.3 on Base via explorer; confirm they are live and match the spec ABI.
3. **Determine Validation Registry status.** The study reports no confirmed mainnet deployment through May 13, 2026. Check Base mainnet and Base Sepolia directly by calling a view function against the expected address.
4. Locate the official reference implementation repository. Confirm it compiles.
5. Check the Base Sepolia addresses referenced in the Eco docs.
6. Check The Graph's Agent0/ERC-8004 subgraph resource for chain coverage — if it covers Base Sepolia we may consume it directly, which strengthens the Graph story ("we compose with their published subgraph").

**Verification:** `docs/VERIFICATION_REPORT.md` §V5 contains a table: registry × chain × address × live(y/n) × ABI-verified(y/n), plus a decision line: **"C5 will [use existing at 0x… | deploy reference impl from <repo>@<sha>]."**

---

### V6 — Subgraph Studio readiness  ·  **RISK: MED**

**Goal:** Confirm the Graph prize's hard requirement — live data from a Graph provider on our target chain — is satisfiable before we build anything that depends on it.

**Plan:**
1. Create the Subgraph Studio account. Create the subgraph slug `proof-of-fill`.
2. Confirm `base-sepolia` is a supported network in Studio.
3. Generate the API key. Record the **query URL format** exactly.
4. Determine current Base Sepolia head block → this becomes `startBlock` (never index from 0; it costs hours).
5. Deploy a trivial throwaway subgraph indexing any known contract. Query it with the API key over HTTP. **Measure and record: deploy → synced latency.** This number governs the demo schedule.
6. Confirm `graph-cli` version and `matchstick-as` compatibility.

**Verification:** `pnpm verify:v6` — issues an authenticated GraphQL query against the throwaway subgraph and prints a non-empty result plus the measured sync latency.

**This is a hard gate on the Graph prize.** If Studio does not support Base Sepolia, the entire chain target changes. Know today.

---

### V7 — Prior-art recon  ·  **RISK: LOW**

**Goal:** Copy the redeployment *pattern* (not the code) from teams who have already solved Aqua-on-Base-Sepolia, saving hours of trial and error.

**Plan:** Read `github.com/Ryad2/liquid_OB` (ArcBook) and `github.com/resistingdestiny/wishing-well-votive` (Votive). Extract: deployment scripts and constructor args, any Aqua/SwapVM patches they needed, how they handled the resolver restriction, whether either appended an opcode, and their subgraph config if present.

**Verification:** `docs/VERIFICATION_REPORT.md` §V7 lists concrete reusable findings. **Note the "Start Fresh" rule:** we may read for pattern, we may not copy project-specific code. Document that we wrote our own.

---

### V8 — Submission requirements  ·  **RISK: LOW**

**Goal:** Never lose on a technicality.

**Plan:** From the ETHGlobal dashboard, capture: exact submission cut-off (date **and** timezone) for each partner prize; required form fields; video length limits and hosting requirements; whether the repo must be public at submission; the "Start Fresh" pool declaration mechanism.

**Verification:** `docs/SUBMISSION_CHECKLIST.md` exists with every field enumerated and every deadline in **IST and UTC**.

---

### V9 — Toolchain & funding readiness  ·  **RISK: HIGH** *(new — not in handover_doc.md)*

**Goal:** Eliminate the boring, schedule-eating blockers that no amount of build speed fixes. Faucet rate limits have ended more hackathons than bad architecture.

**Plan:**
1. Install and pin: `foundry` (record `forge --version`), Node LTS, `pnpm`, `graph-cli`.
2. Provision **two** Base Sepolia RPC endpoints (primary + fallback — public endpoints fail under load; get an Alchemy or QuickNode key).
3. Generate the wallet set deterministically from one mnemonic: deployer, Alice, Bob, Mallory, attestor, zero-score-taker, + 20 Sybil burners. **26 addresses.**
4. Fund the deployer from faucets **starting now** — this is rate-limited and serialized. Target ≥ 0.5 ETH.
5. Confirm that fan-out funding (deployer → 25 wallets in one script) works — never faucet 26 times.
6. Get a BaseScan API key for programmatic verification.
7. Get an Anthropic API key for the LLM layer (C21).

**Verification:** `pnpm verify:v9` — prints a table of every required tool with its version, both RPCs with current block heights, all 26 addresses with balances, and a ✅/❌ per required API key.

**Start the faucet drip before anything else today.** It runs in the background while you do V1.

---

### V10 — Reverted-transaction observability  ·  **RISK: HIGH** *(new — de-risks C15)*

**Goal:** Settle *now* how a failed fill becomes indexed data. `handover_doc.md` §9.6 offers a three-option fallback chain and guesses at option 2; this is the single hardest data-layer problem and it must not be discovered on day 5.

**The constraint:** in the EVM, a full revert unwinds all state **including logs**. An event emitted before a revert does not survive. So options that emit-then-revert are non-starters — confirm this in a test rather than assuming it.

**Plan:** Write a Foundry test proving log behaviour under revert, then evaluate four designs:

| Option | Mechanism | On-chain? | Cost | Trust |
| --- | --- | --- | --- | --- |
| **A** | Router `try`/`catch` on pull → emit `FillFailed` → **do not revert** | ✅ Fully indexable | 1 tx | None |
| **B** | Off-chain: attestor scans receipts with `status == 0` targeting the router, classifies by V2's selector | ❌ Off-chain | free | Trusted attestor |
| **C** | Two-tx: taker calls `FillAttemptRecorder.record()` first, then swaps. Attempt with no completion = failure | ✅ Fully indexable | 2 tx | None |
| **D** | Taker self-reports the revert as an attestation | ❌ Off-chain | 1 tx | Trusted taker |

**Recommendation to validate:** **A as primary, B as backstop.** Option A is fully on-chain, single-transaction, and produces a first-class `FillFailed` event the subgraph indexes natively — strictly better than `handover_doc.md`'s expected option 2. Its cost is semantic: the swap transaction *succeeds* while moving no tokens. Mitigate by making the router return a boolean/status and having the taker treat `FillFailed` as an error — the failure remains loud in the UI and console while staying indexable on chain.

**Verification:** `forge test --match-path test/SpikeRevertLogs.t.sol` proves (a) logs do not survive a full revert, and (b) the chosen option produces an indexable event on maker-insufficient-balance. Decision recorded in the report with rationale.

---

### V11 — Score design review  ·  **RISK: MED** *(new — closes a rubric hole)*

**Goal:** Fix the score formula before it is embedded in a contract, a subgraph, and a dashboard. The formula in `handover_doc.md` §9.3 is `base = honoredValueUsd/1e6`, which makes **score ≈ capital**: a wealthy dishonest agent outranks a poor honest one, and it is trivially inflated by self-dealing. Shipping a "we fixed reputation" pitch on a metric with a C2-robustness flaw invites the obvious question.

**Plan:** Design v2 of the formula against the study's own C1–C4 criteria, adding one cheap field that defeats wash trading:

```
Score{ uint128 honoredValueUsd6; uint32 honoredCount; uint32 failedCount;
       uint32 distinctTakers; uint64 updatedAt }

reliability = honoredCount / (honoredCount + 3 * failedCount)   // failures weigh 3x
diversity   = min(distinctTakers, 5) / 5                        // one counterparty = 0.2x
score       = (honoredValueUsd6 / 1e6) * reliability * diversity
```

`distinctTakers` is the important addition: a self-dealing maker trades with itself, so `diversity` caps its score at 20% no matter how much volume it fakes. This is a direct, on-chain, one-field answer to the strongest objection against the project — and it is measured empirically by C25.

Keep `honoredValueUsd6` exposed raw for display ("$31,240 honored") so the headline number stays legible while the *score* stays defensible.

**Verification:** `docs/SCORE_DESIGN.md` states the formula, justifies each term against C1–C4, and enumerates known limitations. Feeds C6 and C26.

---

### V12 — Static-context event constraint  ·  **RISK: MED** *(new)*

**Goal:** Confirm that `ReputationGate`'s intended `FillAttempted` / `FillCompleted` events are legal where they are placed, and that they do not collide with any reentrancy guard.

**Plan:** From V3's findings, confirm: instructions cannot emit in a `staticcall` quote path (so events must live in the router's swap path, not the instruction); identify where in `AquaSwapVMRouter` the pull occurs so events bracket it correctly; check for a reentrancy guard that a `try`/`catch` (V10 option A) would trip.

**Verification:** Design note in the report specifying the exact file and line where each event will be emitted, and confirmation that quote-path behaviour is unaffected.

---

### Phase 0 exit criteria

Do not start Phase 1 until:

- [ ] V1 outcome recorded: GREEN / AMBER / RED
- [ ] V2 revert selector captured as a hex literal
- [ ] V3 taker-availability answered for **both** quote and swap paths
- [ ] V5 decision line written: use-existing vs deploy-reference
- [ ] V6 authenticated Studio query returns data; sync latency measured
- [ ] V9 deployer funded ≥ 0.5 ETH; both RPCs responding
- [ ] V10 failed-fill design chosen and proven by test
- [ ] V11 `docs/SCORE_DESIGN.md` written
- [ ] `docs/VERIFICATION_REPORT.md` committed

---

## 2. Phase 1 — Foundations

### C1 — Repository scaffold & toolchain

**Goal:** One repo where `forge test`, `pnpm test`, and `graph build` all run green from a cold clone, so that no later component is blocked on plumbing.
**Depends on:** V9 · **Risk:** MED (three build systems is the day-1 tax)

**Plan:**
1. `git init`, public GitHub repo, MIT/Apache license, first commit today.
2. pnpm workspace: `contracts/`, `subgraph/`, `packages/core/`, `services/attestor/`, `agents/`, `dashboard/`, `scripts/`.
3. Foundry in `contracts/` with submodules pinned by SHA: `1inch/aqua`, `1inch/swap-vm`, `forge-std`, `openzeppelin-contracts`, ERC-8004 reference impl (if V5 says deploy).
4. TypeScript base config, `viem` for chain access, `vitest` for TS tests, `zod` for runtime schema validation at every system boundary.
5. `.env.example` covering: `BASE_SEPOLIA_RPC`, `BASE_SEPOLIA_RPC_FALLBACK`, `DEPLOYER_KEY`, `MNEMONIC`, `SUBGRAPH_URL`, `GRAPH_API_KEY`, `BASESCAN_API_KEY`, `ANTHROPIC_API_KEY`.
6. `LICENSES/` preserving the Aqua and SwapVM notices (© Degensoft Ltd) — a 1inch attribution requirement.

**Verification:** `pnpm verify:c1` — from a clean clone: installs, builds all four toolchains, runs every test suite, exits 0. Prints a version table.

---

### C2 — Wallet & funding infrastructure

**Goal:** 26 deterministic, funded, labelled wallets available to every script, so no component ever stalls on "which key was Mallory again."
**Depends on:** V9 · **Risk:** MED

**Plan:**
1. `packages/core/src/wallets.ts` — derive all 26 from one mnemonic at fixed indices. Export a typed registry: `{ deployer, alice, bob, mallory, attestor, poorTaker, sybils: [0..19] }`.
2. `scripts/fund.ts` — fan out from the deployer in a single batched run, idempotent (skips wallets already above threshold), with per-role target balances.
3. `scripts/balances.ts` — print the full table; wire into `verify:v9`.
4. **Sybil funding must be one transaction batch in one block** — this pattern is what the dashboard's Sybil detector (C24) and Mallory's story (C19) depend on. Record the funder address and block number to the manifest.

**Verification:** `pnpm verify:c2` — every wallet exists, is funded above its role threshold, and all 20 Sybils share one funder in one block (asserted by reading chain, not by trusting the script).

---

### C3 — Deployment manifest & verification harness

**Goal:** One typed, committed source of truth for every deployed address, and the aggregate verification runner that makes "done" a machine-checkable state rather than an opinion.
**Depends on:** C1 · **Risk:** LOW (but it is the spine of everything)

**Plan:**
1. `deployments/84532.json` — typed manifest: contract → `{address, deployBlock, txHash, verifiedUrl, sourceCommit}`. Zod schema in `packages/core`.
2. Every deploy script writes to it; nothing hardcodes an address anywhere else, ever.
3. `scripts/verify/` — one module per component exporting `{id, name, run(): Promise<Result>}`.
4. `scripts/verify/all.ts` — runs all, renders `docs/VERIFICATION_REPORT.md` with status, evidence links, timestamp; exits non-zero on regression.
5. Wire `verify:all` into CI.

**Verification:** `pnpm verify:all` runs, produces the report, and correctly fails when a manifest address is deliberately corrupted (test the harness itself).

---

### C4 — CI pipeline

**Goal:** Every push proves the system still builds and passes, and the resulting commit history is the artifact 1inch judges inspect.
**Depends on:** C1 · **Risk:** LOW

**Plan:** GitHub Actions: `forge fmt --check` + `forge test` + `pnpm test` + `graph build` + `pnpm verify:contracts` on push. Cache Foundry and pnpm. Badge in README. Skip live-chain verifications in CI (no secrets); run those locally.

**Verification:** A deliberately broken commit fails CI; reverting turns it green. Screenshot for the submission.

---

## 3. Phase 2 — Contracts

### C5 — Aqua redeploy (Base Sepolia)

**Goal:** Official Aqua exists on Base Sepolia at an address we control, so the claim "official Aqua contracts, redeployed" is literally true.
**Depends on:** V2, V7, C2, C3 · **Risk:** MED

**Plan:**
1. Build the pinned `1inch/aqua` submodule with **upstream's own `foundry.toml`** (compiler version and optimizer settings must match upstream exactly, or provenance arguments get muddy).
2. `script/DeployAqua.s.sol` → deploy → write manifest.
3. Verify on BaseScan programmatically (`forge verify-contract`), capture the URL.
4. **Provenance evidence** — do this instead of chasing a keccak match: record the submodule commit SHA, the solc version, the optimizer settings, and the BaseScan "verified source matches" link. Assert deployed runtime bytecode equals locally compiled runtime bytecode.
5. If V2 found the resolver restriction inside Aqua: apply the **minimum** modification, isolate it in one clearly-commented diff, and document it in `docs/DEVIATIONS.md`. Honesty here is worth more than the claim.

> **Note on `handover_doc.md` §9.1's keccak-match criterion:** matching upstream's *published* bytecode will usually fail for metadata-hash reasons unrelated to source equivalence, and can burn half a day proving nothing. Local-compile-vs-deployed equality plus BaseScan verification is the stronger, achievable evidence. This is a change of evidence, not a reduction of rigor.

**Verification:** `pnpm verify:c5` — reads the manifest, fetches deployed bytecode from chain, compares to local build artifact, confirms the BaseScan verified status via API, prints the provenance block.

---

### C6 — `ProofOfFillScore`

**Goal:** A cheap on-chain score the opcode can read in a quote, written by the attestor, with the formula from V11 and a documented path to trust-minimization.
**Depends on:** V11, C3 · **Risk:** LOW

**Plan:**
1. Struct per V11 including `distinctTakers`. Packed into two slots.
2. `setScore(address, Score)` behind an `ATTESTOR_ROLE`; `setScoreBatch` for efficiency; `scoreOf(address) → uint32`; `rawScoreOf(address) → Score`; `scoreByAgentId(uint256)` via C8's adapter.
3. Pure `computeScore(Score) → uint32` so the formula is independently callable and testable, and so `packages/core` can mirror it exactly (C16).
4. Emit `ScoreUpdated` — the subgraph indexes it, giving the dashboard on-chain score history for free.
5. Saturating arithmetic; never revert on overflow.

**Verification:** `forge test --match-contract ProofOfFillScoreTest`
- [ ] Zero history → 0
- [ ] Failures only → 0
- [ ] `distinctTakers == 1` caps score at exactly 20% of raw value **(the anti-wash-trading property)**
- [ ] Failure weighting: 10 honored / 1 failed scores lower than 10 honored / 0 failed by the documented ratio
- [ ] Overflow clamps rather than reverting (fuzz across `uint128` range)
- [ ] Non-attestor `setScore` reverts
- [ ] Fuzz: `computeScore` never reverts for any struct input

---

### C7 — `ReputationGate` instruction  ·  **THE 1INCH DELIVERABLE**

**Goal:** A SwapVM instruction that reads the taker's Proof-of-Fill score during execution and proceeds, widens the price, or refuses — the "define your own instructions" hook that 1inch explicitly scores higher.
**Depends on:** V1, V3, V12, C6 · **Risk:** GATE

**Plan:**
1. Take V1's outcome: append cleanly (GREEN) or inline in a forked router (AMBER).
2. Args encoded in the program: `minScore (uint32)`, `widenBpsIfBelow (uint16)`, `hardRefuseBelow (uint32)`.
3. Read the taker from the field V3 identified. If V3 found quote is taker-agnostic, implement swap-path enforcement and **update every piece of pitch copy** accordingly.
4. `score < hardRefuseBelow` → `revert TakerBelowReputationFloor(uint32 score, uint32 floor)` — a custom error with both values, because it renders beautifully on camera.
5. `score < minScore` → widen by `widenBpsIfBelow`, mirroring `Fee.sol`'s exact-in/exact-out branch precisely.
6. Else no-op, with an explicit gas-cheap early exit.
7. Safe under `staticcall`: no state writes, no events (per V12).
8. **Ordering guard:** the gate must precede pricing instructions. Enforce in the C10 builder (compile-time) *and* document the runtime consequence.

**Verification:** `forge test --match-contract ReputationGateTest -vvv`
- [ ] High-score taker: quote **byte-identical** to the same program without the gate
- [ ] Taker below `minScore`: output worse by **exactly** `widenBpsIfBelow` (assert the arithmetic, not a range)
- [ ] Exact-in and exact-out both widen correctly
- [ ] Taker below `hardRefuseBelow`: reverts `TakerBelowReputationFloor(0, 100)` with both args correct
- [ ] **Regression:** a stock XYCSwap program produces an identical quote on our router and on the unmodified upstream router (upstream opcode indices intact)
- [ ] Gate is a no-op in a static quote context and does not revert unexpectedly
- [ ] Fuzz: random scores × random thresholds → output is monotonic in score, never reverts outside the refuse band

---

### C8 — `ProofOfFillSwapVMRouter` + `ReputationRegistryAdapter`

**Goal:** The deployed router that carries our instruction and emits the fill telemetry the entire data layer consumes.
**Depends on:** C5, C7, V10, V12 · **Risk:** HIGH

**Plan:**
1. Router = official `AquaSwapVMRouter` + `ReputationGate` registered in the instruction table.
2. Emit `FillAttempted(strategyHash, maker, taker, tokenIn, tokenOut, amountIn)` immediately before the pull, and `FillCompleted(..., amountOut)` after — placed per V12's line-level design note.
3. Implement V10's chosen failed-fill design (expected: `try`/`catch` around the pull → `FillFailed(strategyHash, maker, taker, reason)` → do not revert; return a status the taker treats as an error).
4. `ReputationRegistryAdapter` — maps ERC-8004 `agentId` ↔ wallet address using the Identity Registry's `agentWallet` metadata, so the score is addressable by agent identity as well as by address.
5. Deploy, verify on BaseScan, write the manifest.

**Verification:** `pnpm verify:c8` + `forge test --match-contract RouterTest`
- [ ] Deployed and BaseScan-verified; manifest updated
- [ ] Successful swap emits `FillAttempted` then `FillCompleted` with matching amounts
- [ ] Maker-insufficient-balance emits `FillFailed` **and the receipt has `status == 1`** (so logs survive and are indexable)
- [ ] Adapter resolves `agentId → address` and back for all three demo agents
- [ ] No reentrancy guard is tripped by the `try`/`catch`

---

### C9 — Program encoder / builder

**Goal:** Reliable, tested construction of SwapVM program bytes containing a custom opcode — because the maker agent, the taker agent, and every test must produce byte-identical programs or the strategy hash won't match and nothing works.
**Depends on:** V4, C7 · **Risk:** HIGH *(broken out from `handover_doc.md` §9.8 — it is a distinct failure surface)*

**Plan:**
1. `packages/core/src/program.ts` — a typed builder: `program().gate({minScore, widenBps, refuseBelow}).xyc({...}).fee(30).encode()`.
2. If V4 says the SDK can't encode custom opcodes, hand-encode against the V4 byte-equality baseline.
3. **Ordering validation at build time:** throw if `gate()` is called after a pricing instruction.
4. Strategy-hash computation mirroring the contract exactly.
5. `test/ProgramDecode.t.sol` — a Solidity fixture decoding bytes produced by TypeScript, asserting field-by-field equality. **This round-trip is the single most important cross-language test in the project.**

**Verification:** `pnpm verify:c9`
- [ ] TS-encoded bytes decode correctly in Solidity for gate/XYC/fee combinations
- [ ] TS-computed strategy hash equals the contract's for 10 random programs
- [ ] Builder throws on gate-after-pricing
- [ ] Stock program (no gate) matches the V4 SDK baseline byte-for-byte

---

### C10 — Fill & revert proof

**Goal:** An executable proof that both outcomes exist on-chain, so the entire pitch rests on tested behaviour rather than narrative.
**Depends on:** C5, C8, C9 · **Risk:** MED

**Plan:** `test/FillAndRevert.t.sol` on a Base Sepolia fork:
1. Alice approves Aqua, ships 5 WETH / 10k USDC. **Assert her wallet balances are unchanged** — this is the "never deposited" claim, proven.
2. Bob swaps 2,500 USDC → ~1 WETH. Assert: Alice WETH ↓, Alice USDC ↑, Bob inverse, Aqua virtual balances updated, `FillCompleted` emitted with correct amounts.
3. Alice transfers her remaining WETH away (the betray).
4. Bob's next swap produces the failure path. Assert `FillFailed` is emitted and capture the reason bytes.
5. Assert the failure is **indexable** — a log exists in a `status == 1` receipt.

**Verification:** `forge test --match-contract FillAndRevertTest -vvv` — all five green. This test is the empirical foundation of the entire pitch; if it is red, nothing downstream is true.

---

### C11 — Invariant & fuzz suite

**Goal:** Evidence of engineering seriousness beyond happy-path tests, and genuine confidence in the score math.
**Depends on:** C6, C7 · **Risk:** LOW *(ambition addition)*

**Plan:** Foundry invariant tests:
- Score is monotonic non-decreasing in `honoredValueUsd` (all else equal)
- Score is monotonic non-increasing in `failedCount`
- Score never exceeds raw honored value
- `distinctTakers == 1` ⟹ score ≤ 20% of raw, **for all inputs**
- Gate never changes output for takers above `minScore`
- Router never moves tokens when the gate refuses

**Verification:** `forge test --match-path 'test/invariant/*' ` with ≥ 10,000 runs, all green.

---

## 4. Phase 3 — ★ Vertical slice (the integration gate) ★

### C12 — Thin end-to-end path

**Goal:** Prove that bytes flow across all four systems — contracts, chain, subgraph, TypeScript — **before** any of them is finished. This is the highest-value component in the plan and it exists nowhere in `handover_doc.md`.

**Depends on:** C5, C6, C8, C9 · **Risk:** GATE

Deliberately ugly. No gate enforcement, no LLM, no attestor service, no dashboard, no Mallory, no styling.

**Plan:**
1. Alice ships one hardcoded strategy via a script (real tx, Base Sepolia).
2. A minimal subgraph — **one entity, two handlers** (`FillCompleted`, `FillFailed`) — deployed to Studio.
3. A 30-line script that queries the subgraph with the API key and prints the fill count.
4. Bob swaps once via script (real tx).
5. Poll until the fill appears in the subgraph. **Record the true end-to-end latency.**
6. Write a score to `ProofOfFillScore` from the script; read it back on-chain.

**Verification:** `pnpm verify:c12` — one command that runs ship → swap → poll subgraph → write score → read score, and prints every tx hash. Passes when it completes twice consecutively from a clean state.

**Do not proceed to Phase 4 until this is green.** Every integration assumption in the project is validated or destroyed here, on day 3, when there is still time to react.

---

## 5. Phase 4 — Data layer

### C13 — Subgraph schema & mappings

**Goal:** The live index that turns raw events into per-agent Proof-of-Fill numbers joined to ERC-8004 identity and reviews — the join that makes The Graph load-bearing.
**Depends on:** V2, V5, V6, C12 · **Risk:** HIGH

**Plan:**
1. **Data sources:** Aqua (ship/dock/pull/push, names per V2) · our router (`FillAttempted`/`FillCompleted`/`FillFailed`) · 8004 Identity (`Registered`, `URIUpdated`, `MetadataSet`, `Transfer`) · Reputation (`NewFeedback`, `FeedbackRevoked`) · Validation (per V5) · `ProofOfFillScore` (`ScoreUpdated`).
2. **Entities:** `Agent`, `Maker`, `Strategy`, `Fill{status: HONORED|FAILED}`, `Attestation`, `Review`, `Reviewer`, `ScoreSnapshot`.
3. Aggregates on `Agent`: `reviewCount`, `reviewAvg`, `honoredCount`, `failedCount`, `honoredValueUsd`, `distinctTakers`, `proofOfFillScore`.
4. **The join:** link `Agent` (8004 identity) ↔ `Maker` (Aqua address) via the C8 adapter, so one query answers "who does this agent claim to be" *and* "what has it actually done." This is the sentence that wins the Graph prize — make sure the schema makes it a single query.
5. `Reviewer` entity tracking funder address and funding block — powers the Sybil drawer.
6. USD valuation: fixed token prices in a documented constant (a testnet oracle is out of scope; document the assumption honestly).
7. Named queries in `subgraph/queries/`: `Candidates(tokenA, tokenB)`, `AgentHistory(id)`, `SybilAnalysis(agentId)`, `FillsFeed(limit)`.

**Verification:** `pnpm verify:c13` + matchstick
- [ ] Matchstick unit tests for `handleShip`, `handleFillCompleted`, `handleFillFailed`, `handleFeedback`, `handleRegistered`, `handleScoreUpdated`
- [ ] `Candidates` returns Alice's strategy within 60s of a live ship
- [ ] A FAILED fill appears after the betray flow
- [ ] `AgentHistory` returns the identity↔behaviour join in **one** query
- [ ] `distinctTakers` computed correctly across multiple takers

---

### C14 — Studio deployment & live-data proof

**Goal:** Satisfy The Graph's hard requirement — live data from a Graph provider, queried with a Studio API key — and be able to *show* it.
**Depends on:** V6, C13 · **Risk:** MED

**Plan:** Versioned deploys (`v0.0.x`), authenticated query wrapper in `packages/core` with retry and a sync-status check, a `LiveIndicator` data source comparing subgraph head to chain head, and a documented redeploy runbook (deploy → sync latency → when it is safe to record).

**Verification:** `pnpm verify:c14` — issues an authenticated query against the **deployed Studio endpoint** (not a local node), asserts non-empty results, prints subgraph head vs chain head and the lag in blocks. **Fails if lag > 50 blocks** — this is the pre-recording gate.

---

### C15 — Failed-fill pipeline

**Goal:** Guarantee that broken promises are as visible in the data as kept ones — the asymmetry the whole thesis rests on.
**Depends on:** V10, C8, C13 · **Risk:** HIGH

**Plan:** Implement V10's chosen design end to end, plus the backstop: a receipt scanner in the attestor that catches any `status == 0` transaction targeting the router, classifies it by the V2 revert selector, and reconciles against subgraph state. Belt and braces — a missing failure is a silent, pitch-destroying bug.

**Verification:** `pnpm verify:c15`
- [ ] Betray flow produces a `FILLED → FAILED` record within 60s
- [ ] The failed `Fill` links to a real, explorer-viewable tx hash
- [ ] Backstop scanner independently detects the same failure (cross-check)
- [ ] `failedCount` increments in subgraph **and** on-chain
- [ ] No false positives across a 20-fill honest run

---

### C16 — Shared score library

**Goal:** One implementation of the score, mirrored exactly by the contract, so the dashboard, Bob, and the attestor can never disagree about a number on screen.
**Depends on:** C6, V11 · **Risk:** MED *(new — prevents three divergent implementations)*

**Plan:** `packages/core/src/score.ts` — a pure TS port of `computeScore`, plus a differential test that runs both implementations over the same inputs and asserts equality.

**Verification:** `pnpm verify:c16` — 1,000 random `Score` structs evaluated by the Solidity contract (via `viem` call) and the TS function; **all 1,000 must match exactly.**

---

## 6. Phase 5 — Services & agents

### C17 — Attestor service

**Goal:** Turn indexed fill outcomes into ERC-8004 Validation Registry attestations and keep the on-chain score fresh — the step that puts the record where agents already look.
**Depends on:** V5, C6, C13, C15, C16 · **Risk:** HIGH

**Plan:**
1. Poll loop: query subgraph for `Fill` where `attestation == null`.
2. Build the attestation payload `{agentId, fillTxHash, status, amountIn, amountOut, tokenIn, tokenOut, blockNumber, chainId}`; hash it; host as a `data:` URI (IPFS as a stretch — `data:` is more reliable for a demo).
3. Call the Validation Registry using the exact request/response pattern from V5, embedding the fill tx hash in the tag/hash field.
4. Recompute aggregates (including `distinctTakers`) via C16; call `setScoreBatch`.
5. Idempotency via a local SQLite/JSON store keyed by fill id; safe across restarts.
6. Receipt-scanner backstop from C15.
7. **Console output designed for camera:** structured, colourized, one line per action with tx links. This service appears in the video.
8. Graceful degradation: RPC failover, exponential backoff, never crash-loop.

**Verification:** `pnpm verify:c17`
- [ ] After one honored fill: an attestation tx exists; subgraph links it to the fill
- [ ] `scoreOf(alice) > 0` on-chain, matching C16's TS computation exactly
- [ ] After a failed fill: `failedCount` increments on-chain
- [ ] Kill -9 mid-loop and restart → no duplicate attestations (assert on-chain count)
- [ ] Survives a forced primary-RPC failure by using the fallback

---

### C18 — Maker agent (Alice)

**Goal:** A readable, demoable agent that is a genuine Aqua maker — registers an 8004 identity, ships a gated SwapVM strategy from its own wallet, and can be made to break its promise on command.
**Depends on:** C5, C8, C9, C19-registries · **Risk:** MED

**Plan:** `pnpm alice <cmd>` for `register` · `approve` · `ship` · `dock` · `reship` · `betray` · `status`.
- `register`: 8004 Identity with a `data:` URI registration JSON including `agentWallet`.
- `ship`: builds `[ReputationGate][XYCSwap][Fee]` via C9, ships to Aqua, prints tx + strategyHash + **"wallet balance unchanged: 5.000 WETH"**.
- `betray`: demo-only, clearly labelled, transfers committed WETH away to create a real broken promise.
- `status`: wallet balances vs committed amounts vs live score.

**Verification:** `pnpm verify:c18`
- [ ] Each command prints a real tx hash and an explorer link
- [ ] `ship` proves wallet balance unchanged by reading chain before and after
- [ ] Program bytes round-trip through the Solidity decoder (C9)
- [ ] Strategy appears in `Candidates` within 60s
- [ ] `betray` → `dock` → `reship` returns Alice to a clean, demoable state (needed for repeat dry runs)

---

### C19 — ERC-8004 registries, seed & Sybil agent (Mallory)

**Goal:** The demo foil — an agent with a perfect review score and zero delivery, produced by the exact Sybil pattern the study documents, so the argument is shown rather than asserted.
**Depends on:** V5, C2 · **Risk:** MED

**Plan:**
1. Per V5: locate or deploy Identity, Reputation, Validation registries; verify; manifest.
2. `SeedDemo.s.sol` registers `alice`, `mallory`, `bob`, `poorTaker` with `data:` URI registration JSON. Idempotent.
3. `pnpm mallory seed`: fund 20 burners **from one wallet in one block**, post 20 max-score reviews on Mallory, with tags matching the study's observed pattern.
4. Give Mallory a *plausible* registration file — the point is that she is indistinguishable from Alice on every fakeable axis.
5. `docs/SIMULATION.md` labels this unambiguously as a simulated attack on our own testnet deployment.

**Verification:** `pnpm verify:c19`
- [ ] Three registries live and BaseScan-verified; addresses in manifest
- [ ] Four `Registered` events on explorer
- [ ] 20 `NewFeedback` events on Mallory; `reviewAvg` matches Alice's in the subgraph
- [ ] All 20 reviewers share one funder in one block, asserted by reading chain
- [ ] Script is idempotent (run twice → no duplicates)
- [ ] Mallory's `honoredCount == 0` and `proofOfFillScore == 0`

---

### C20 — Taker agent (Bob)

**Goal:** The AI use case — an agent that reads live Graph data, reasons about who to trust, and executes a real on-chain swap on the strength of that reasoning.
**Depends on:** C13, C16, C18, C19, C21 · **Risk:** HIGH

**Plan:**
1. `Candidates(WETH, USDC)` against the live Studio endpoint.
2. Fetch full fill history for each candidate — the LLM needs raw behaviour, not just aggregates.
3. Call C21's risk analyst → structured verdict.
4. **Deterministic safety rail (must survive the LLM):** never select a maker with `honoredCount == 0` when one with `honoredCount > 0` exists. The rail guarantees the demo; the LLM does the reasoning inside it.
5. `quote()` → display → `swap()` with byte-identical program bytes → tx + explorer link.
6. On `FillFailed` / refusal: print "counterparty failed to deliver" prominently and trigger C15.
7. `pnpm bob buy 1 WETH` · `pnpm bob analyze <agent>` · `pnpm bob ask "<question>"`.

**Verification:** `pnpm verify:c20`
- [ ] `bob buy` prints candidate table → reasoning → quote → confirmed tx
- [ ] Bob selects Alice over Mallory, and the printed rationale cites `honoredValue`, `failedCount`, and `reviewAvg`
- [ ] From the zero-score wallet against Alice's gated strategy: prints `TakerBelowReputationFloor(0, 100)`
- [ ] After `alice betray`: prints the delivery failure and a failed `Fill` is indexed
- [ ] **Rail test:** with the LLM stubbed to return "choose Mallory," the code still refuses to select her
- [ ] Output is stable across 3 consecutive runs (recordability)

---

### C21 — LLM reasoning layer

**Goal:** Make the AI genuinely load-bearing rather than decorative. `handover_doc.md` §9.10 concedes the LLM "only writes the explanation" — correct for demo safety, but The Graph's prize is *Best AI Use Case*, and a judge who reads the prompt file will notice. This component gives the model real work that the deterministic rail cannot do, while keeping the rail.
**Depends on:** C13 · **Risk:** MED *(new — closes a rubric hole)*

**Plan — two AI surfaces, both consuming live Graph data:**

**1. Risk analyst** (`agents/taker/analyst.ts`) — reads each candidate's **full fill history** from the subgraph and returns structured JSON:
```
{ recommendation, confidence, flags[], rationale }
```
Flags the deterministic rail cannot produce:
- `COUNTERPARTY_CONCENTRATION` — fills clustered on one taker (wash-trading signal)
- `TEMPORAL_CLUSTERING` — all fills in one narrow window (manufactured history)
- `VALUE_ANOMALY` — fill sizes inconsistent with committed liquidity
- `REVIEW_DELIVERY_DIVERGENCE` — high reviews, no delivery (the Mallory signature)
- `RECENT_DEGRADATION` — failures concentrated in recent history

This is real reasoning over indexed on-chain behaviour, it directly reinforces the anti-Sybil thesis, and it is only possible because The Graph indexes both sides of the join.

**2. Natural-language interface** (`pnpm bob ask`) — translates questions into GraphQL against our subgraph and answers in prose. *"Which makers have never failed a fill over $10k?"* · *"Has anyone's score dropped this week?"* The Graph's criteria list a natural-language interface as explicitly qualifying.

Use `claude-sonnet-5` for the analyst (structured output, low latency) — model id pinned in config. Validate every response with `zod`; on malformed output, fall back to the deterministic summary rather than failing the demo. Prompts live in `agents/taker/prompts/` as reviewable files.

**Verification:** `pnpm verify:c21`
- [ ] Analyst returns schema-valid JSON for Alice, Mallory, and a wash-trading fixture
- [ ] Correctly raises `REVIEW_DELIVERY_DIVERGENCE` on Mallory
- [ ] Correctly raises `COUNTERPARTY_CONCENTRATION` on the C22 wash-trading wallet
- [ ] NL interface answers 5 canned questions with correct numbers (assert against direct GraphQL)
- [ ] Malformed LLM output degrades to the deterministic path without crashing
- [ ] **Ablation test:** with the subgraph unreachable, the analyst cannot function — proving The Graph is load-bearing. This test *is* the Graph qualification evidence.

---

## 7. Phase 6 — Adversarial validation

> This phase does not exist in `handover_doc.md`. It converts the project's biggest intellectual weakness into its most persuasive demo moment.

### C22 — Cost-to-fake harness

**Goal:** Empirically measure what it costs to fake a Proof of Fill score versus a review score, and prove the C4 economic-soundness claim with data instead of assertion.

**The problem it solves:** `handover_doc.md` §16 answers "wash trading?" with "costs gas + fees + capital." On our Base Sepolia deployment with the resolver restriction removed, self-dealing costs approximately nothing. A sharp judge asks *"what stops Alice from being her own Bob?"* — and right now the honest answer is "on mainnet, a KYC gate we deliberately removed." Measure it instead of hand-waving.

**Depends on:** C13, C16, C19, C20 · **Risk:** MED

**Plan:**
1. `scripts/attack/wash-trade.ts` — a fresh attacker maker + attacker taker attempting to pump a score to match Alice's $31,240 by self-dealing.
2. Instrument every cost: gas units consumed, fees paid, capital locked, wall-clock time, number of transactions.
3. **Report in mainnet-equivalent terms** using real Base gas prices and real token prices — because testnet gas is free and saying otherwise would be dishonest.
4. `scripts/attack/sybil-reviews.ts` — same measurement for the review attack (reuses C19), yielding our own empirical number to sit beside the study's $0.0027.
5. **Show the defence working:** the attacker trades only with itself, so `distinctTakers == 1`, so V11's diversity factor caps the fake score at 20% of raw. Demonstrate that the attacker must recruit ≥ 5 distinct counterparties — multiplying cost and coordination — to score competitively.
6. Emit `docs/COST_TO_FAKE.md` with the comparison table, auto-generated from measured data.

**Verification:** `pnpm verify:c22`
- [ ] Wash-trade attack runs to completion and reports total measured cost
- [ ] Sybil-review attack runs and reports total measured cost
- [ ] The generated table shows both, in mainnet-equivalent USD
- [ ] Attacker's final score is demonstrably capped by the diversity factor
- [ ] Numbers are reproducible across two runs (within gas-price variance)
- [ ] `docs/COST_TO_FAKE.md` states limitations honestly, including that testnet gas is free

**Why this is worth the day:** it answers the strongest objection on camera with a number you measured; it validates the `distinctTakers` design; and it demonstrates the intellectual honesty that separates a research-grade submission from a demo.

---

### C23 — Score simulator

**Goal:** Show the formula's behaviour under adversarial and edge conditions, so "we thought about robustness" is a chart rather than a claim.
**Depends on:** C16 · **Risk:** LOW

**Plan:** A script sweeping the parameter space — honest agent, wash trader, whale, high-volume-with-failures, newcomer — and emitting a comparison table plus a small chart for the README. Include the C2-robustness demonstration: how many records does it take to move a score, versus the Reputation Registry's plain mean where one record moves it.

**Verification:** `pnpm verify:c23` — produces the table; asserts the honest low-volume agent outranks the high-volume wash trader; output committed to `docs/SCORE_DESIGN.md`.

---

## 8. Phase 7 — Surface

### C24 — Dashboard

**Goal:** One page that makes the entire argument visible without narration: the fakeable number and the real number side by side, every number a link to chain, failures as loud as successes.
**Depends on:** C13, C14, C16, C17, C20 · **Risk:** MED

**Design authority:** `handover_doc.md` §10 in full — principles §10.2, the anti-defaults list §10.3, the settlement-ledger direction §10.4, wireframes §10.5, and the ten-second test §10.6. Load the `frontend-design` skill before building and follow its two-pass process.

**Plan:**
1. Vite + React + TypeScript. Design tokens first, per §10.4 (graphite base `#1E2329`, delivered `#3FD39B` as the *only* saturated colour, claimed `#8B94A0` deliberately dull).
2. Live data layer: typed `viem` + GraphQL hooks against the Studio endpoint and RPC. **No mocked data anywhere** — a Graph qualification requirement.
3. Components: `AgentsTable` · `GapBar` (the one bold element) · `ReviewersDrawer` (with the "all 20 funded by 0x7a…f3 in block N" line, computed from real data) · `AgentDetail` (right-side panel, with decoded program chips) · `FillsFeed` · `TakerConsole` (three scenarios) · `LiveIndicator` · `Badge` · **`CostToFakePanel`** (new — surfaces C22's measured numbers).
4. Motion exactly once, per §10.4: the winning row lifts 4px and its delivered segment extends over ~600ms. Respect `prefers-reduced-motion`.
5. Empty and error states written as instructions, per §10.4.

**Verification:** `pnpm verify:c24`
- [ ] Renders entirely from live subgraph + RPC; a network-level assertion confirms zero mocked data
- [ ] All three `TakerConsole` scenarios run end to end from the page
- [ ] Every hash is a working BaseScan link (automated link-check across the rendered DOM)
- [ ] Readable at 1080p with no scrolling on Screen A
- [ ] Keyboard focus visible throughout; `prefers-reduced-motion` honoured
- [ ] Playwright screenshot of Screen A in the prepared demo state, committed to the repo
- [ ] **The ten-second test (§10.6), self-critiqued against the screenshot:** can someone who has never heard of this tell that Alice and Mallory look identical by reviews and opposite by delivery? Is delivered value the only saturated thing on screen? Are failures impossible to miss? Iterate until all three are yes.

---

## 9. Phase 8 — Delivery

### C25 — Demo orchestration

**Goal:** One command that puts chain, subgraph, and dashboard into the exact state the video starts from, so recording is repeatable rather than a performance.
**Depends on:** everything above · **Risk:** MED

**Plan:**
1. `pnpm demo:reset` — return to a clean state (dock strategies, clear local attestor store, restore Alice's balances). **This is what makes repeat dry runs possible**; without it, every mistake costs a redeploy.
2. `pnpm demo:prepare` — deploy check → seed agents + Sybil reviews → Alice approve + ship → **12 honored fills by Bob** → attestor caught up → assert dashboard shows Alice 12 ✓ / 0 ✗ and Mallory ★4.9 / $0. Must run **≥ 30 minutes before recording** so Studio has indexed.
3. `pnpm demo:run` — the three live scenarios in order: (1) Bob chooses and swaps, (2) zero-score taker refused with `TakerBelowReputationFloor`, (3) `alice betray` → Bob refused → dashboard updates to 12 ✓ / 1 ✗ with the score visibly dropping.
4. `pnpm demo:check` — pre-flight: RPC health, subgraph lag < 50 blocks, all balances sufficient, attestor running, dashboard reachable. **Run this immediately before hitting record.**
5. `docs/DEMO_SCRIPT.md` — shot list with measured timings from real dry runs.

**Verification:** `pnpm verify:c25`
- [ ] Two consecutive full cycles (`reset` → `prepare` → `run`) complete with zero manual intervention
- [ ] `demo:check` correctly fails when the subgraph is deliberately lagged
- [ ] Timings recorded and stable across both runs

---

### C26 — Documentation

**Goal:** Judges can run it and understand it without you in the room — an explicit Graph requirement and an implicit 1inch one.
**Depends on:** C25 · **Risk:** LOW

**Plan:**

`README.md`: what this is · why reviews fail (citing arXiv 2606.26028) · how Aqua makes fills verifiable · architecture · **contract addresses from the manifest** · SwapVM opcode docs with the instruction-order warning · subgraph URL + sample queries · quickstart · trust assumptions · **known limitations** · Start Fresh declaration · video link · attribution ("Powered by Aqua — © Degensoft Ltd", "Powered by SwapVM — © Degensoft Ltd").

Supporting docs: `ARCHITECTURE.md` · `SCORE_DESIGN.md` (C6/V11/C23) · `COST_TO_FAKE.md` (C22) · `DEVIATIONS.md` (every modification to upstream code, with rationale) · `SIMULATION.md` (Mallory is a simulated attack) · `TRUST_ASSUMPTIONS.md` · `DEMO_SCRIPT.md` · `SUBMISSION_CHECKLIST.md` · `VERIFICATION_REPORT.md`.

**Write the limitations section with real teeth** — testnet gas is free so self-dealing is cheap here; the attestor is a trusted updater in the prototype; the score measures financial reliability only; USD valuation uses fixed prices; mainnet execution is resolver-restricted. Judges reward a team that found its own holes far more than they punish having them.

**Verification:** `pnpm verify:c26` — a fresh clone on a fresh wallet with ~0.05 ETH runs `pnpm i && pnpm setup && pnpm demo:prepare` successfully. Every address in the README matches the manifest (automated). Every internal link resolves.

---

### C27 — Video

**Goal:** A 2–4 minute recording containing all four mandatory beats, because a missing beat costs a prize regardless of code quality.
**Depends on:** C25, C26 · **Risk:** MED

**The four beats that must be visibly present** (`handover_doc.md` §1.1 "One demo, two rubrics"):
1. ✅ An on-chain token transfer with the explorer open *(1inch)*
2. ✅ The custom SwapVM instruction doing something *(1inch)*
3. ✅ The Subgraph Studio page and an API-keyed query *(The Graph)*
4. ✅ The agent reasoning over that data before acting *(The Graph)*

**Plan:** Follow `handover_doc.md` §15's beat sheet. **Record in segments and edit** — do not attempt a single live take across a testnet. Capture 2–3 takes of each segment. Add the C22 cost-to-fake table as a beat: *"faking 20 five-star reviews cost $X. Faking an equivalent Proof of Fill costs $Y — and the diversity factor caps it anyway."* End card: repo, addresses, subgraph URL.

**Verification:** `docs/VIDEO_CHECKLIST.md` — a reviewer other than you confirms all four mandatory beats are visible, runtime is 2–4 minutes, audio is intelligible, and text is legible at 1080p.

---

### C28 — Submission

**Goal:** Both submissions in, correctly, before the cut-off.
**Depends on:** C26, C27 · **Risk:** LOW *(but it is the only irreversible deadline)*

**Plan:** Work `docs/SUBMISSION_CHECKLIST.md` from V8. Select **Start Fresh**. Confirm the repo is public. Submit **Sept 13**, not the 16th.

**Verification:** Both forms submitted; confirmation screenshots saved; every checklist box in `handover_doc.md` §12 ticked with evidence links.

---

## 10. Schedule

| Day | Date | Focus | Gate to clear |
| --- | --- | --- | --- |
| **0** | Sep 5 | Phase 0 (V1–V12), C1 scaffold, git init, **start faucet drip first** | V1 outcome known; V6 Studio query works; deployer funded |
| **1** | Sep 6 | C2 wallets, C3 harness, C4 CI, C5 Aqua, C6 score, C19 registries | Aqua + registries live and verified |
| **2** | Sep 7 | **C7 ReputationGate**, C8 router, C9 encoder | `forge test` green on the gate |
| **3** | Sep 8 | C10 fill/revert, C11 invariants, **★ C12 vertical slice ★** | **End-to-end path proven** |
| **4** | Sep 9 | C13 subgraph, C14 Studio, C15 failed fills, C16 score lib | Live `Candidates` + a FAILED fill indexed |
| **5** | Sep 10 | C17 attestor, C18 Alice, C19 Mallory, C20 Bob, C21 LLM | Bob chooses Alice and swaps, live |
| **6** | Sep 11 | C22 cost-to-fake, C23 simulator, C24 dashboard (build) | Attack numbers measured |
| **7** | Sep 12 | C24 dashboard (polish + ten-second test), C25 orchestration, 2 dry runs | Two clean dry runs |
| **8** | Sep 13 | C27 video, C26 docs, C28 submission | **Submitted** |
| — | Sep 14–16 | Buffer: stretch goals, re-record, Composable Graph track | — |

**Non-negotiable checkpoints.** If any of these slips, re-plan the same day rather than absorbing it:

- **End of day 0:** V1 answered. The gate's feasibility is known.
- **End of day 3:** C12 green. If bytes don't flow end to end by day 3, the integration risk is real and the remaining days get re-sequenced.
- **End of day 5:** Bob completes a real swap chosen from live Graph data. Both prize stories now exist as running code.
- **End of day 7:** two clean dry runs. Recording day is safe.

---

## 11. Risk register

| # | Risk | Likelihood | Impact | Mitigation | Trigger to act |
| --- | --- | --- | --- | --- | --- |
| R1 | SwapVM opcode table can't be extended | Med | High | V1 spike day 0; fall back to forked router (still "modified SwapVM") | V1 = AMBER/RED |
| R2 | `quote()` is taker-agnostic → no quote-time gating | Med | Med | Enforce at swap time; **change pitch copy everywhere** | V3 finding |
| R3 | Studio doesn't support Base Sepolia | Low | **Critical** | Re-target chain immediately | V6 fails |
| R4 | Validation Registry doesn't exist anywhere | Med | Med | Deploy reference impl; frame as "among its first users" | V5 finding |
| R5 | Faucet rate limits starve 26 wallets | **High** | Med | Start drip day 0; fan out from one funded deployer | Any wallet under threshold |
| R6 | Failed fills aren't indexable | Med | High | V10 option A (try/catch, no revert) + receipt-scan backstop | V10 test |
| R7 | Subgraph lag during recording | **High** | Med | `demo:check` gate; pre-run 30+ min; only 3 live scenarios | Lag > 50 blocks |
| R8 | Base Sepolia RPC flakiness | **High** | Med | Two providers + failover in every client | Any timeout |
| R9 | LLM picks wrong agent on camera | Med | High | Deterministic rail (C20); rail tested with a hostile stub | Rail test fails |
| R10 | Integration breaks late | Med | **Critical** | C12 vertical slice on day 3 | C12 not green by day 3 |
| R11 | Dashboard looks generic | Med | Med | §10.3 anti-defaults list; ten-second self-critique | Screenshot review |
| R12 | Scope overrun | **High** | Med | Insurance list below — *only* on a missed checkpoint | Day-5/7 checkpoint miss |
| R13 | Judge attacks the wash-trading claim | **High** | Med | **C22 measures it; `distinctTakers` defends it; limitations documented** | — (pre-empted) |
| R14 | "Start Fresh" pool violation | Low | **Critical** | Read prior art for pattern only; never copy code; document | Any code reuse |

**Insurance list — not a plan, and touched only on a missed checkpoint, in this order:** Badge → sparkline → NL query interface → `AgentDetail` panel → C23 simulator → mainnet subgraph → Composable Graph track. Everything ahead of `AgentDetail` in that order is garnish; nothing before C22 is.

---

## 12. Resources required

**From you (blocking — do these today, in parallel with V1):**
- [ ] Base Sepolia faucet drip started → deployer ≥ 0.5 ETH
- [ ] Alchemy/QuickNode Base Sepolia key (primary) + a second provider (fallback)
- [ ] Subgraph Studio account + `proof-of-fill` slug + API key
- [ ] BaseScan API key
- [ ] Anthropic API key
- [ ] Public GitHub repo created
- [ ] ETHGlobal submission deadlines captured (V8)

**Budget:** ~0.5 Base Sepolia ETH (free, but rate-limited — hence the drip), ~$5–20 of Anthropic API usage, $0 infrastructure.

---

## 13. Demo-day runbook

**T–60 min:** `pnpm demo:reset && pnpm demo:prepare` · **T–35:** verify Studio has indexed all 12 fills · **T–10:** `pnpm demo:check` (all green or do not record) · **T–5:** browser at 1080p, console sized, `verify:all` report open in a tab · **T–0:** record in segments per §15.

**If it breaks mid-record:** subgraph lag → cut, wait, re-record that segment · RPC failure → switch provider, re-run · gate doesn't revert → check the taker wallet is the zero-score one, not Bob · dashboard blank → check `SUBGRAPH_URL` and API key, not the code.

**Never** debug live on camera. Cut, fix, re-take the segment.

---

## 14. Definition of done

The project is complete when `pnpm verify:all` is green across all 28 components **and**:

- [ ] A real WETH transfer from Alice's wallet is viewable on BaseScan *(1inch #2)*
- [ ] `TakerBelowReputationFloor` reverts a real transaction on BaseScan *(1inch #1, #5)*
- [ ] Aqua and the modified SwapVM are deployed and verified from official sources *(1inch #1)*
- [ ] Git history shows ≥ 60 commits across ≥ 8 days *(1inch #3)*
- [ ] Bob's counterparty choice is provably derived from a live, API-keyed Studio query *(Graph #1, #2)*
- [ ] The C21 ablation test proves the agent cannot function without The Graph *(Graph #1)*
- [ ] The LLM performs reasoning the deterministic rail cannot *(Graph #3)*
- [ ] Repo is public with a README a stranger can run *(Graph #4)*
- [ ] Video is 2–4 min and contains all four mandatory beats *(both)*
- [ ] Start Fresh selected and declared *(Graph #5)*
- [ ] `docs/COST_TO_FAKE.md` contains measured, reproducible numbers
- [ ] `docs/DEVIATIONS.md` lists every modification to upstream code
- [ ] Limitations are documented honestly and prominently

---

## 15. Deltas from `handover_doc.md`

Everything in the original is preserved. This plan **adds**:

| Addition | Why |
| --- | --- |
| **C12 vertical slice (day 3)** | Integration is where multi-system hackathon projects die. Proves the risk away while there is time to react. |
| **C22 cost-to-fake harness** | Turns the project's weakest claim (§16 "wash trading?") into a measured number and a demo beat. |
| **`distinctTakers` in the score (V11)** | One cheap field that structurally defeats self-dealing and answers the strongest objection on-chain. |
| **C21 real AI work** | The Graph's prize is *Best AI Use Case*; §9.10's LLM only writes explanations. Adds analysis the rail can't do — and an ablation test proving Graph dependence. |
| **V9 funding / V10 revert-observability / V12 static-context** | Three unaddressed blockers, each capable of eating a day if found late. |
| **C16 shared score library** | Prevents contract, dashboard, and agent from disagreeing about a number on screen. |
| **C3 verification harness + C4 CI** | Makes "done" machine-checkable and produces the git history 1inch grades. |
| **C25 `demo:reset` and `demo:check`** | Makes dry runs repeatable and recording safe. |
| **Provenance evidence over keccak-matching (C5)** | Upstream bytecode matching usually fails on metadata for reasons unrelated to source equivalence. Stronger evidence, achievable. |

Nothing is removed. The insurance list in §11 is contingency, not scope.
