# Proof of Fill — Complete Handoff Document

> **For:** Claude Code, running in goal mode.
> **What this is:** the single source of truth for building, demoing, and pitching Proof of Fill at ETHGlobal Online 2026 (Sept 4–16, 2026). It merges the implementation spec and the pitch research so nothing lives elsewhere.
> **Today:** September 5, 2026. Submission target: September 13 (buffer before the 16th).
> **Partners:** 1inch (Build an Aqua App) + The Graph (Best AI Use Case, From Scratch). No third partner. Net-new build, "Start Fresh" pool.
>
> **How to work this document:**
>
> 1. Read §1–§5 once for context. §1.1 lists the two partners, their exact qualification rules, and what each judge wants to see — check every build decision against it. You will need the _why_ to make good micro-decisions.
> 2. Do §14 (verification tasks) **before writing any code**. Report findings, then proceed.
> 3. Build components in the order of §9. Each component has a **Goal**, **Inputs**, **Outputs**, **Acceptance criteria**, and **Depends on**. Treat acceptance criteria as the definition of done for goal mode.
> 4. Before building the dashboard (§9.11), load `/mnt/skills/public/frontend-design/SKILL.md` if available and follow §10 exactly.
> 5. Commit after every acceptance criterion passes. 1inch judges check git history.
> 6. Items marked `VERIFY` are assumptions. Do not build on them until checked.

---

## 1. One-paragraph summary

AI agents now pay each other on-chain, and before paying they check the counterparty's ERC-8004 reputation. That reputation is broken: the first empirical study of the standard found the majority of reviewers on Base are coordinated Sybils and a fake review costs a quarter of a cent. **Proof of Fill** replaces reviews with something that can't be faked — an agent's record of _honoring on-chain quotes with real tokens_. Agents market-make from their own wallets on 1inch Aqua (no deposit, no vault). Every honored fill and every failed fill is indexed by a Graph subgraph and written into the agent's ERC-8004 Validation Registry as an attestation pointing at the real transaction. A taker agent chooses counterparties by "value honored / times reneged" instead of star ratings, and a custom SwapVM opcode lets makers enforce that score at quote time. Tagline: **reputation you had to pay for.**

### 1.1 Partners targeted, prizes, and what each judge is looking for

We are submitting to exactly **two** partner prizes. Every build decision should be checked against both sets of requirements below. **Do not add a third partner integration** (Bazantic/x402, Ledger, Chainlink, World, ENS, Arc are all explicitly out of scope — x402 is mentioned in the video as "next," nothing more).

#### Partner 1 — 1inch: "Build an Aqua App" ($5,000 pool: $2,500 / $1,500 / $1,000)

- **What they want:** a custom Aqua app implementing a sophisticated DeFi position, demonstrated through tests or a UI. **Projects that use SwapVM are scored higher.** Modifying SwapVM opcodes and defining your own instructions is explicitly encouraged.
- **Qualification requirements (verbatim intent):**
  1. Official Aqua/SwapVM contracts must be used; redeploying a _modified_ SwapVM contract is allowed.
  2. On-chain execution of token transfers must be shown in the final demo (local forks OK).
  3. Proper git commit history — no single-commit entries on the final day.
- **How Proof of Fill satisfies it:** official Aqua bytecode redeployed unmodified to Base Sepolia (§9.1); official SwapVM router redeployed with one appended instruction, `ReputationGate` (§9.2) — this is the "define your own instructions" hook; Bob's swap is a real on-chain transfer shown with the explorer (§9.10, §15); commits per acceptance criterion from day one.
- **What to emphasize for these judges:** the opcode. Show the program chips `[ReputationGate][XYCSwap][Fee]` in the UI and the refused-swap revert on camera. Frame the project as "a trust layer over phantom liquidity" — a problem specific to Aqua's no-deposit design that they will recognize.
- **Their resources:** https://github.com/1inch/swap-vm , https://github.com/1inch/aqua , https://github.com/1inch/sdks/tree/master/typescript/aqua , SwapVM and Aqua whitepapers in those repos.
- **Secondary upside (post-hackathon, not a build task):** the 1inch DAO Aqua Revenue Stream Incubator ($436k unallocated, up to $50k/team) explicitly asks for "new swapVM instructions" — `ReputationGate` is an application-ready candidate. Note this in the README's "what's next."

#### Partner 2 — The Graph: "Best AI Tooling or AI Use Case with The Graph (From Scratch)" ($5,000 pool: $2,500 / $1,500 / $1,000)

- **What they want:** either AI tooling that makes The Graph easier to use from AI environments, **or an AI agent/app that uses The Graph as its live source of blockchain data** (research assistants, trading and execution agents, risk monitors, etc.). We are the second kind.
- **Two pools:** _Net-new (Start Fresh)_ vs _Continuity_. **We are Start Fresh.** Open-source starter kits are fine; project-specific prior code is not. Select the Start Fresh pool on the ETHGlobal submission form and state in the README that no pre-existing project code was used.
- **Qualification requirements (verbatim intent):**
  1. The Graph is a **load-bearing** part of the project — the agent uses Subgraphs, the Subgraph MCP, or Substreams as its source of blockchain data.
  2. **Consume live data from a Graph provider** — e.g., querying Subgraphs with an API key from **Subgraph Studio**. Mocked, local-only, or static datasets do not qualify.
  3. **Do meaningful work with the data:** reasoning, decisions, automation, or a natural-language interface — not just printing a raw query result.
  4. Open-source the code with a clear README so judges can run it; public repo + 2–4 minute demo video.
  5. Select the matching pool and follow its rules.
- **How Proof of Fill satisfies it:** the Aqua + ERC-8004 subgraph is deployed to Subgraph Studio and queried with a Studio API key (§9.6); Bob (§9.10) computes the Proof-of-Fill score _only_ from that live subgraph, reasons about it with an LLM, and executes a real swap — delete The Graph and Bob cannot score anyone; the dashboard reads the same live data. Show the Studio page in the video (§15).
- **What to emphasize for these judges:** the join. "The ERC-8004 subgraph tells you who an agent claims to be; joined to the Aqua subgraph it tells you what the agent has actually done. That join only exists because both sides are indexed." Mention that we reuse their listed Agent0/ERC-8004 subgraph resource where possible.
- **Their resources:** Subgraph MCP https://thegraph.com/docs/en/subgraphs/tooling/subgraph-mcp/introduction/ , Subgraph SKILLs https://github.com/graphprotocol/subgraphs-skills , Agent0/ERC-8004 subgraphs https://thegraph.com/docs/en/subgraphs/existing-subgraphs/agent0/ .
- **Optional secondary Graph track (only if ahead of schedule):** "Best Use of Composable or Standardized Graph Products" ($5,000) requires composing two or more Graph products (e.g., Subgraph + Substreams) or building on a standardized schema, with live data. Composing our Aqua subgraph with a Substreams module that reads real wallet balances (phantom-liquidity detection) would qualify. **Do not attempt until §9.1–§9.12 are all green.**

#### One demo, two rubrics

The single 3-minute video (§15) must contain, visibly: (a) an on-chain token transfer with the explorer open (1inch), (b) the custom SwapVM instruction doing something (1inch), (c) the Subgraph Studio page and an API-keyed query (The Graph), and (d) the agent reasoning over that data before acting (The Graph). If any of those four is missing from the recording, re-record.

#### Deadlines

ETHGlobal Online 2026 runs Sept 4–16. Internal target: everything submitted by **Sept 13**. `VERIFY` the exact partner submission cut-off on the ETHGlobal dashboard on day 1 and write it into `docs/SUBMISSION_CHECKLIST.md`.

---

## 2. Background you need

### 2.1 Aqua (1inch) — the liquidity layer

- Aqua is a **registry, not a pool**. It stores virtual balances keyed by `(maker, app, strategyHash, token)`. Tokens stay in the maker's wallet until pulled during a swap. README: "Aqua doesn't hold tokens — it maintains allowance records."
- Maker flow: `token.approve(aqua, max)` once → `aqua.ship(app, strategyBytes, tokens, amounts)` → strategy live (ledger entry only) → `aqua.dock(app, strategyHash, tokens)` to withdraw (ledger entry only).
- Swap flow: app calls `aqua.pull(maker, strategyHash, tokenOut, amountOut, recipient)` (transfers from maker wallet using the approval); taker pushes `tokenIn` via `aqua.push(...)`.
- **Key property:** if the maker's wallet lacks the tokens at pull time, the swap **reverts**. That revert is a public record of a broken quote.
- Strategies are immutable once shipped. Re-parameterize = dock + ship.
- Official Aqua address on all 13 mainnets: `0x499943e74fb0ce105688beee8ef2abec5d936d31`. **Official deployments are mainnet-only.** Prior hackathon teams (ArcBook, Votive) redeployed official bytecode to **Base Sepolia**. We do the same.
- **At launch, `swap` on mainnet is restricted to verified 1inch Resolvers (KYC NFT).** Our taker executes on our Base Sepolia redeploy. `VERIFY` whether the restriction lives in the router or in Aqua and whether our redeploy can drop it.
- Source of truth: https://github.com/1inch/aqua

### 2.2 SwapVM (1inch) — the strategy language

- A strategy is a **bytecode program** of instructions (`XYCSwap`, `XYCConcentrate`, `PeggedSwap`, `Decay`, `Fee`, `Controls`, `Balances`), encoded with maker traits and shipped to Aqua via the `AquaSwapVMRouter` (the "app").
- The taker must supply the **exact same program bytes** to reproduce the strategy hash when swapping.
- `quote()` runs in a static context; `swap()` executes. **Instruction order is security-critical** (per 1inch).
- Custom instructions can be appended; **the hackathon rules explicitly allow redeploying a modified SwapVM, and projects using SwapVM score higher.**
- Sources: https://github.com/1inch/swap-vm (read `docs/PROGRAMS.md`, `src/routers/AquaSwapVMRouter.sol`, `src/instructions/Controls.sol`, `src/libs/VM.sol`). SDKs: `@1inch/swap-vm-sdk` (exports incl. `Order`, `MakerTraits`, `AquaAMMStrategy`, `AQUA_SWAP_VM_CONTRACT_ADDRESSES`) and `@1inch/aqua-sdk` (`AquaProtocolContract`, `AQUA_CONTRACT_ADDRESSES`); monorepo https://github.com/1inch/sdks. `VERIFY` current exports.

### 2.3 ERC-8004 — Trustless Agents

- Three registries per chain: **Identity** (agents are ERC-721; `agentURI` → registration JSON; optional `agentWallet` metadata for payout address), **Reputation** (free-form feedback `(agent, client, value, decimals, tag1, tag2)` + off-chain feedback file — the Sybil-prone one), **Validation** (independent attestations `(validator, agent, verdict)` — the one we write to).
- Spec: https://eips.ethereum.org/EIPS/eip-8004. Mainnet Jan 29, 2026. Canonical mainnet addresses (from the study): Identity `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`, Reputation `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` on ETH/BSC/Base. `VERIFY` Validation Registry address — the study reports **no confirmed mainnet deployment through May 13, 2026**. Reference implementations are reported deployed to Base Sepolia. `VERIFY` Base Sepolia addresses; if absent, deploy the reference implementation and document.
- The Graph lists Agent0/ERC-8004 subgraphs as an official resource: https://thegraph.com/docs/en/subgraphs/existing-subgraphs/agent0/ — `VERIFY` chain coverage.

### 2.4 The Graph

- Requirement: **live data from a Graph provider** (Subgraph Studio with an API key). Mocked/local/static data disqualifies.
- Studio supports Base Sepolia and Base mainnet. Primary deployment: Base Sepolia (where demo fills happen). Stretch: Base mainnet against official Aqua for a "live production data" shot.
- Docs: https://thegraph.com/docs/ ; Subgraph SKILLs: https://github.com/graphprotocol/subgraphs-skills

---

## 3. Why this should exist (the pain, with numbers)

### 3.1 Agents are economic actors; trust infra isn't ready

- ERC-8004 drew **170,000+ registered agents** and **150,000+ feedback records** across Ethereum, BSC, and Base within months of its Jan 29, 2026 launch; 50+ organizations (MetaMask, EF, Google, Coinbase) contributed to the spec.
- x402 on Base went from near-zero to **100M+ cumulative transactions** by Q1 2026; $1+ transactions rose from 49% to 95% of volume. Agent settlement is 98.6% USDC.

### 3.2 The Reputation Registry does not work (arXiv 2606.26028, July 2026)

The study defines four conditions a reputation score must meet and shows the registry meets none:

| Condition                 | Meaning                              | Finding                                                               |
| ------------------------- | ------------------------------------ | --------------------------------------------------------------------- |
| **C1 Commensurability**   | Same thing, same scale               | Values unbounded; free-form tags; 764 Base records score >100         |
| **C2 Robustness**         | Minority can't move the score        | Plain mean; one record moves it                                       |
| **C3 Groundedness**       | Each record = verifiable interaction | No stake, no registration, no prior interaction required              |
| **C4 Economic soundness** | Faking costs more than it extracts   | Median cost per feedback: **$0.055 ETH / $0.0042 BSC / $0.0027 Base** |

- **73.5% / 59.2% / 90.6%** of reviewers on ETH / BSC / Base show coordinated Sybil behavior, affecting **26.4% / 81.4% / 96.2%** of rated agents.
- After removing Sybil feedback, **15.8% / 77.9% / 86.8%** of rated agents have **no valid feedback left**.
- On BSC, 76 reviewers produced 29,444 records (avg 387 each).
- Only **3% / 4% / 15%** of registered agents expose a valid registration file with a live service endpoint. Top 1% of wallets own 58.5% of agents on ETH, 54.9% on Base.
- Cross-chain scores are uncorrelated (Spearman ρ = 0.05 BSC–Base). Each chain is a silo.

### 3.3 The spec left the slot open

ERC-8004 explicitly expects "an ecosystem of specialized services for agent scoring, auditor networks, and insurance pools" on top of the registry; the study notes "the reviewer-reputation layer envisioned by the protocol does not yet exist." Proof of Fill is that layer, grounded in the strongest available proof: not that someone paid, but that a counterparty delivered.

### 3.4 The Aqua-side pain: phantom offers

Aqua lets a maker post an offer without depositing — so a maker can advertise liquidity it doesn't have and the swap reverts at pull time. Today the only way to know if an Aqua maker is real is to try. Proof of Fill fixes both pains with one record.

### 3.5 Why now

1. Standard launched Jan 29; weakness published July 8; nobody has shipped a fix.
2. Validation Registry reportedly had no mainnet deployment through May — we may be among its first real users. `VERIFY`.
3. Aqua only exists since July 28, 2026; "honored fills" wasn't buildable before.
4. The industry model is agents-within-limits (Coinbase for Agents, Kraken MCP, OKX toolkit, MetaMask Advanced Permissions) — all need a counterparty signal.

---

## 4. The solution and how it maps

### 4.1 Mechanism (plain language)

1. **Alice** (agent) registers an 8004 identity and approves Aqua once.
2. Alice ships a strategy: "I'll sell up to 5 ETH along this curve." Her wallet still shows 5 ETH.
3. **Bob** (agent) takes 1 ETH. 2,500 USDC moves Bob→Alice, 1 ETH moves Alice→Bob. A **fill**.
4. If Alice had moved her ETH away, the tx **reverts**: a public "promised, couldn't deliver" record.
5. A subgraph aggregates per maker: honored count, honored USD value, failed count.
6. An attestor writes each outcome into Alice's **Validation Registry** entry with the tx hash.
7. Bob (and any contract) reads _reviews_ (fakeable) and _Proof of Fill_ (verifiable) side by side and chooses.
8. Alice's strategy includes a `ReputationGate` opcode that refuses or widens quotes for takers with no honored history.

### 4.2 Satisfying C1–C4

| Condition | Proof of Fill                                                                                       |
| --------- | --------------------------------------------------------------------------------------------------- |
| C1        | One scale: USD honored, count honored, count failed                                                 |
| C2        | One record = one real trade; score moves only with proportional value                               |
| C3        | Every record is a tx hash; score re-derivable from chain                                            |
| C4        | Faking = trading with yourself: gas + fees + capital; on mainnet the taker must be a KYC'd resolver |

### 4.3 What it deliberately does not claim

It measures **financial reliability** (does this agent deliver what it quotes), not task quality. That narrowness is the point.

---

## 5. Competitive landscape

| Category                  | Examples                                                                             | Scores by                                          | Fails                                    | Relationship                                                       |
| ------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------ |
| Review-based 8004 scorers | Global Score Agent (HUMI Index), Origin DAO SDK, Praxis Protocol, community scanners | Aggregating/filtering Reputation Registry feedback | C3, C4                                   | We replace their input, not their UI; they could consume our score |
| Capability verification   | AgentPass, "Proof of Agency Gauntlet"                                                | One-time challenge tests                           | Measures _can it_, not _does it deliver_ | Complementary                                                      |
| Stake-secured validation  | 8004's high-assurance tier (re-execution, AVS-style)                                 | Validator stake per task                           | Expensive; no running record             | Complementary                                                      |
| Cryptographic attestation | zkML, TEE                                                                            | Proves a computation ran                           | Not counterparty delivery                | Complementary                                                      |
| Payment-proof feedback    | 8004 v2 roadmap: x402 proofs in feedback                                             | Proves the _buyer paid_                            | Doesn't prove the _seller delivered_     | Closest in spirit; we're the other half                            |
| Aqua tooling              | ArcBook, Aqua0, HarvestAqua                                                          | Not reputation                                     | —                                        | Nobody scores Aqua makers                                          |

**One-line differentiators:** vs review scorers — they filter noise, we remove the noise source. vs payment proofs — a payment proves the buyer paid; a fill proves the seller delivered. vs staked validation — they answer "was this task correct" at high cost; we answer "does this agent keep its word" continuously for gas.

**Threats:** 8004 v2 standardizing fill-style proofs (we'd become the reference impl — move fast); 1inch adding maker reputation natively (nothing announced; we're on their opcode path); a review scorer adding fill data (needs Aqua's no-deposit model to be general).

---

## 6. Goals and non-goals

**Goals**

1. Maker agent with 8004 identity ships a real SwapVM strategy from its wallet on Base Sepolia.
2. Subgraph indexes every ship/dock/honored fill/failed fill per maker, joined to 8004 IDs.
3. Attestor writes fill outcomes to the Validation Registry with tx hashes.
4. Taker agent queries the subgraph, computes Proof-of-Fill scores, reasons visibly, executes a real swap.
5. `ReputationGate` SwapVM opcode enforces the score at quote time.
6. A presentable dashboard: reviews vs Proof of Fill side by side, every number a link.
7. 2–4 min video + README judges can run.

**Non-goals:** x402 (mention as next step), cross-chain, production MM strategy, mainnet execution, multi-page UI.

---

## 7. Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                          Base Sepolia (our redeploy)                  │
│  Aqua (official bytecode)   ProofOfFillSwapVMRouter (+ReputationGate)│
│         ▲      ▲                       ▲                             │
│    ship │      │ pull/push             │ swap/quote                  │
│   Maker agent  │               Taker agent (Bob) ── reads score      │
│   (Alice, 8004)│                                                     │
│  ERC-8004 registries (Identity / Reputation / Validation)            │
│         ▲  validationResponse(fill outcome, txHash)                  │
│   Attestor  ◄── polls ──  Aqua subgraph (Subgraph Studio)            │
│                                ▲ indexes events                      │
└────────────────────────────────┼─────────────────────────────────────┘
                          Dashboard (subgraph + registries + live RPC)
```

---

## 8. Repository layout

```
proof-of-fill/
├── README.md
├── contracts/                          # Foundry
│   ├── lib/                            # submodules: 1inch/aqua, 1inch/swap-vm, forge-std, openzeppelin, erc-8004 ref impl (if needed)
│   ├── src/
│   │   ├── instructions/ReputationGate.sol
│   │   ├── ProofOfFillScore.sol
│   │   ├── ReputationRegistryAdapter.sol
│   │   └── router/ProofOfFillSwapVMRouter.sol
│   ├── script/ DeployAqua.s.sol · DeployRouter.s.sol · DeployERC8004.s.sol · SeedDemo.s.sol
│   └── test/   ReputationGate.t.sol · FillAndRevert.t.sol · EndToEnd.t.sol
├── subgraph/   subgraph.yaml · schema.graphql · src/aqua.ts · src/erc8004.ts · tests/
├── services/attestor/
├── agents/ maker/ · taker/ · sybil/
├── dashboard/                          # Vite + React (or plain HTML) — see §10
├── deployments/84532.json              # immutable address manifest
├── LICENSES/                           # Aqua + SwapVM notices preserved
└── docs/ DEMO_SCRIPT.md · ARCHITECTURE.md · SUBMISSION_CHECKLIST.md
```

---

## 9. Components — goals, acceptance criteria, dependencies

Build in this order. Each block is a self-contained goal for goal mode.

### 9.1 Component: Aqua redeploy (Base Sepolia)

- **Goal:** the official, unmodified Aqua contract exists on Base Sepolia at an address we control, verified on BaseScan, so that we can truthfully say "official Aqua contracts."
- **Inputs:** `1inch/aqua` submodule at a pinned tag; Base Sepolia RPC + funded deployer key.
- **Outputs:** `deployments/84532.json` → `{ "aqua": "0x…" }`; BaseScan verification link.
- **Acceptance criteria:**
  - `forge build` in the aqua submodule with upstream `foundry.toml` produces bytecode whose keccak matches upstream's published/compiled bytecode (document how you compared).
  - Contract verified on BaseScan.
  - Address written to manifest; manifest committed.
- **Depends on:** nothing. Do first.

### 9.2 Component: `ProofOfFillSwapVMRouter` + `ReputationGate` instruction

- **Goal:** a SwapVM router that is the official `AquaSwapVMRouter` with one new instruction appended — `ReputationGate` — which reads the taker's Proof-of-Fill score at quote/swap time and proceeds, widens the price, or reverts.
- **Inputs:** `1inch/swap-vm` submodule; `ProofOfFillScore` address (9.3).
- **Outputs:** deployed router address in manifest; `ReputationGate.sol`; encoding helper for the instruction's args.
- **Design:**
  - Args encoded in program: `minScore (uint32)`, `widenBpsIfBelow (uint16)`, `hardRefuseBelow (uint32)`.
  - Reads taker from the VM context (`VERIFY` field name in `VM.sol`; audit describes `SwapQuery{maker, taker, tokenIn, tokenOut, isExactIn}`).
  - `score < hardRefuseBelow` → `revert TakerBelowReputationFloor(score, floor)`.
  - `score < minScore` → worsen price by `widenBpsIfBelow` by adjusting the mutable registers (`VERIFY`: mirror how `Fee.sol` adjusts for exact-in vs exact-out).
  - Else no-op. Safe in static (quote) and swap contexts.
  - Must be placed **before** pricing instructions. Encode this as a builder-side check.
  - Also emit `FillAttempted(strategyHash, maker, taker, tokenIn, tokenOut, amountIn)` before the pull and `FillCompleted(..., amountOut)` after (`VERIFY` no reentrancy-guard conflict) — needed by 9.6 to detect failed fills.
- **Acceptance criteria (`ReputationGate.t.sol`):**
  - High-score taker gets identical quote to a program without the gate.
  - Taker below `minScore` gets a price worse by exactly `widenBpsIfBelow`.
  - Taker below `hardRefuseBelow` reverts with `TakerBelowReputationFloor`.
  - Program builder rejects a program with the gate placed after pricing.
  - Existing upstream opcode indices unchanged (test: a stock XYC program produces the same quote on our router as on the unmodified router).
- **Depends on:** 9.1, 9.3.

### 9.3 Component: `ProofOfFillScore` (on-chain score cache)

- **Goal:** a small contract holding a per-address score the opcode can read cheaply, written by the attestor, with a documented path to trust-minimization.
- **Storage:** `mapping(address => Score{uint128 honoredValueUsd6; uint32 honoredCount; uint32 failedCount; uint64 updatedAt})`.
- **API:** `setScore(address, Score)` (attestor role only); `scoreOf(address) → uint32`; `scoreByAgentId(uint256)` via adapter.
- **Formula (keep simple, document it):** `base = min(honoredValueUsd6 / 1e6, 2^32−1)`; if `failedCount > 0`, `score = base * honoredCount / (honoredCount + failedCount)`.
- **Acceptance criteria:** unit tests for formula edge cases (zero history, failures only, overflow clamp); role restriction enforced; README section "Trust assumptions" explains the attestor is a trusted updater in the prototype and how anyone can re-derive the score from the subgraph.
- **Depends on:** nothing (deploy before 9.2).

### 9.4 Component: Fill-and-revert proof (`FillAndRevert.t.sol`)

- **Goal:** an executable proof that both outcomes exist on-chain — an honored fill moves tokens from the maker's wallet, and an over-committed maker causes a revert at pull time — so the whole pitch rests on tested behavior, not narrative.
- **Acceptance criteria:**
  - Alice approves and ships 5 WETH / 10k USDC; assert wallet balances unchanged after `ship`.
  - Bob swaps 2,500 USDC → ~1 WETH; assert Alice's WETH decreased, USDC increased, Aqua virtual balances updated, `FillCompleted` emitted.
  - Alice transfers remaining WETH away; Bob's next swap reverts; assert revert and capture the selector/reason (document it — 9.6 needs it); assert `FillAttempted` was emitted before the revert if events survive (they won't in a revert — see 9.6 fallback chain).
- **Depends on:** 9.1, 9.2.

### 9.5 Component: ERC-8004 registries + demo seed

- **Goal:** three registries usable on Base Sepolia, three demo agents registered, and a labeled Sybil review set on Mallory.
- **Steps:** locate canonical Base Sepolia deployments (`VERIFY`); else deploy reference implementation from the official repo/boilerplate and record addresses. `SeedDemo.s.sol` registers `alice` (honest maker), `mallory` (foil), `bob` (taker) with `data:` URI registration JSON. 20 burner wallets, funded from one address in one block, post 5-star feedback on Mallory (this funding pattern is what the dashboard's Sybil hint reads).
- **Acceptance criteria:** three `Registered` events visible on explorer; 20 `NewFeedback` events on Mallory; addresses in manifest; script is idempotent.
- **Depends on:** 9.1 (deployer setup).

### 9.6 Component: Subgraph (Subgraph Studio, `base-sepolia`)

- **Goal:** the live index that turns raw events into per-agent Proof-of-Fill numbers, joined to 8004 identities and reviews, queryable with a Studio API key.
- **Data sources:** Aqua (ship/dock/pull/push — `VERIFY` event names in `Aqua.sol`), our router (`FillAttempted`/`FillCompleted`), 8004 Identity (`Registered`, `URIUpdated`, `MetadataSet`, `Transfer`), Reputation (`NewFeedback`, `FeedbackRevoked`), Validation (`VERIFY` event names).
- **Failed fills — fallback chain (pick first that works):**
  1. Router emits `FillAttempted` before pull; a `FillAttempted` with no `FillCompleted` in the same tx = failed. (Only works if the tx doesn't revert entirely — in a full revert no events survive. So:)
  2. Attestor scans receipts with `status == 0` targeting the router, classifies by revert selector from 9.4, and posts a `FillFailed` attestation event that the subgraph indexes.
  3. Taker agent posts the failed attestation itself after catching the revert (document as taker-reported).
     Expect to land on option 2.
- **Schema:** entities `Agent`, `Maker`, `Strategy`, `Fill{status: HONORED|FAILED}`, `Attestation`, `Review` (full schema in the prior spec; keep field names). Key aggregates on `Agent`: `reviewCount`, `reviewAvg`, `honoredCount`, `failedCount`, `honoredValueUsd`, `proofOfFillScore`.
- **Queries to expose:** `Candidates(tokenA, tokenB)` → active strategies with maker agent scores; `AgentHistory(id)` → fills, reviews, attestations.
- **Acceptance criteria:** deployed to Studio; `.env.example` has `SUBGRAPH_URL` + `GRAPH_API_KEY`; `Candidates` returns Alice's strategy within 60s of ship; a FAILED fill appears after the betray flow; matchstick tests for `handleShip`, `handleFillCompleted`, `handleFeedback`.
- **Depends on:** 9.1, 9.2, 9.5.

### 9.7 Component: Attestor service

- **Goal:** the process that turns indexed fill outcomes into ERC-8004 Validation Registry attestations and keeps the on-chain score cache fresh.
- **Loop:** poll subgraph for `Fill` with `attestation == null` → build JSON `{agentId, fillTxHash, status, amountIn, amountOut, tokenIn, tokenOut, blockNumber}` → hash → host (data: URI or IPFS) → call Validation Registry (`VERIFY` request/response pattern and who may call) with fill txHash in the tag/hash field → recompute aggregate → `ProofOfFillScore.setScore`. Idempotent via local store. Logs formatted to read well on camera.
- **Acceptance criteria:** after one honored fill, an attestation tx exists and the subgraph links it to the fill; `scoreOf(alice)` > 0 on-chain; after a failed fill, `failedCount` increments on-chain; restart-safe.
- **Depends on:** 9.3, 9.5, 9.6.

### 9.8 Component: Maker agent (Alice)

- **Goal:** a readable script that makes Alice a real Aqua maker: register, approve, build a SwapVM program with `ReputationGate` + `XYCSwap` + `Fee`, ship, and optionally re-ship; plus a demo-only `betray` command.
- **Acceptance criteria:** `pnpm alice register|approve|ship|dock|betray` each print the tx hash and (for ship) the strategyHash and "wallet balance unchanged"; program bytes round-trip through the Solidity decoder (unit test); if the SDK can't encode the custom opcode, hand-encode with a tested helper.
- **Depends on:** 9.2, 9.5.

### 9.9 Component: Sybil agent (Mallory)

- **Goal:** the demo foil — an agent with a perfect review score and zero on-chain delivery, produced by the exact Sybil pattern the study documents.
- **Acceptance criteria:** `pnpm mallory seed` registers Mallory, funds 20 burners from one wallet in one block, posts 20 max-score reviews; README labels this clearly as a simulation.
- **Depends on:** 9.5.

### 9.10 Component: Taker agent (Bob)

- **Goal:** the AI use case — an agent that reads live subgraph data, reasons about which maker to trust, and executes a real swap.
- **Flow:** `Candidates` query → LLM call (prompt in `prompts/choose_counterparty.md`) returns choice + ≤3-sentence explanation citing honoredValue, failedCount, reviewAvg → hard rule in code: never pick a maker with `honoredCount == 0` when one with `honoredCount > 0` exists → `quote()` → `swap()` with the same program bytes → print tx + explorer link → on revert, print "counterparty failed to deliver" and trigger 9.6 option 2/3.
- **Acceptance criteria:** `pnpm bob buy 1 WETH` prints a candidate table, the reasoning, the quote, a confirmed tx; a second run from a zero-score wallet against Alice's gated strategy prints the `TakerBelowReputationFloor` revert; output is stable enough to record.
- **Depends on:** 9.6, 9.8, 9.9.

### 9.11 Component: Dashboard

- **Goal:** the demo surface. One page that makes the whole argument visible without narration: the fakeable number and the real number side by side, every number a link to chain, failures as visible as successes, and one orchestrated moment when Bob chooses.
- **Sub-components and their goals:**
  - `AgentsTable` — _Goal:_ show Alice and Mallory identical in reviews and opposite in Proof of Fill, at a glance.
  - `GapBar` (the memorable element) — _Goal:_ per agent, a single horizontal bar with two segments: "claimed" (review score, rendered deliberately muted) and "delivered" (honored value, the only saturated color on screen). Mallory's delivered segment is empty. This bar is the product in one glyph.
  - `ReviewersDrawer` — _Goal:_ expand a review count into reviewer addresses and surface the funding pattern ("all 20 funded by 0x7a…f3 in block N").
  - `AgentDetail` — _Goal:_ full history: fills table, attestations table, active strategies with decoded program chips, and the live wallet balance line "never deposited."
  - `FillsFeed` — _Goal:_ latest fills across agents with green HONORED / red FAILED badges, newest first, updating live.
  - `TakerConsole` — _Goal:_ run Bob from the page (or stream CLI output) with three canned scenarios: honest, gated, betrayed. The "print receipt" moment.
  - `LiveIndicator` — _Goal:_ prove the data is live (subgraph head vs chain head, Studio link).
  - `Badge` (stretch) — _Goal:_ an embeddable one-liner `[✓ Proof of Fill · $31,240 honored · 0 failed]` linking to AgentDetail — the GTM wedge.
- **Acceptance criteria:** renders from live subgraph + RPC with no mocked data; all three scenarios play end-to-end in the console; every hash is a working explorer link; readable at 1080p without zoom; passes the §10 design review (Claude Code critiques its own screenshot before calling it done); keyboard focus visible; reduced motion respected.
- **Depends on:** 9.6, 9.7, 9.10.

### 9.12 Component: Demo orchestration

- **Goal:** one command that puts the chain, subgraph, and dashboard into the exact state the video starts from, so recording is repeatable.
- **`pnpm demo:prepare`:** deploy check → seed agents + Sybil reviews → Alice approve + ship → 12 honored fills by Bob (pre-run 30+ min before recording so Studio has indexed) → attestor caught up → dashboard shows Alice 12 ✓ / 0 ✗, Mallory ★4.9 / $0.
- **`pnpm demo:run`:** the three live scenarios in order: Bob chooses & swaps → zero-score taker refused → `alice betray` then Bob refused, dashboard shows 12 ✓ / 1 ✗.
- **Acceptance criteria:** two consecutive dry runs from a fresh state complete without manual intervention; timings noted in `docs/DEMO_SCRIPT.md`.
- **Depends on:** everything above.

### 9.13 Component: README, docs, video, submission

- **Goal:** judges can run it and understand it without you in the room.
- **README sections:** what this is (§1) · why reviews fail (cite arXiv 2606.26028) · how Aqua makes fills verifiable · architecture (§7) · contract addresses (manifest) · SwapVM opcode docs with the instruction-order warning · subgraph URL + sample queries · trust assumptions · known limitations (resolver restriction on mainnet; financial reliability only; public bytecode) · pool selection ("Start Fresh") · video link · attribution ("Powered by Aqua — © Degensoft Ltd", "Powered by SwapVM — © Degensoft Ltd"; preserve notices in `LICENSES/`).
- **Acceptance criteria:** `pnpm i && pnpm setup && pnpm demo:prepare` works on a fresh Base Sepolia wallet with ~0.05 ETH; video is 2–4 min and follows §15; both submission forms filled (§12).
- **Depends on:** 9.12.

---

## 10. UI and visual design brief

The dashboard is the demo. It must be beautiful _in service of clarity_: a judge with no context should understand the argument from the screen alone in ten seconds. Before building, load `/mnt/skills/public/frontend-design/SKILL.md` if present and follow its two-pass process (plan tokens → review against this brief → build → critique a screenshot).

### 10.1 Subject and audience

- **Subject:** receipts. A fill is a receipt for a promise kept; a failed fill is a receipt for a promise broken. The interface is a ledger of receipts, not a marketing site and not a generic SaaS dashboard.
- **Audience:** hackathon judges from 1inch and The Graph (crypto-native, watching a 3-minute video), then agent-framework developers evaluating whether to integrate.
- **Primary job:** make the gap between _claimed_ reputation and _delivered_ value impossible to miss.

### 10.2 Design principles (non-negotiable)

1. **Two numbers, side by side, always.** Reviews (fakeable) next to Proof of Fill (verifiable). Never show one without the other.
2. **Every number is a link to a transaction.** If it can't be clicked through to chain, don't show it.
3. **Failure is a first-class state.** Red FAILED badges are the feature. Never hide, collapse, or soften them.
4. **Spend boldness in one place.** The `GapBar` is the memorable element. Everything else is quiet.
5. **Built for video.** Large type, high contrast, no modals covering content, nothing that requires scrolling on the primary screen at 1080p.
6. **Motion once.** One orchestrated moment: when Bob chooses, the chosen row rises and a receipt "prints" into the fills feed. No hover animations on every card, no fade-in on every section.
7. **Copy is plain.** "Honored", "Failed to deliver", "Never deposited", "Verify on BaseScan". No jargon in the UI ("attestation" appears only in the table that literally lists attestations).

### 10.3 Direction to avoid (these read as generated defaults)

- Near-black background with a single acid-green accent.
- Cream background with serif display and terracotta accent.
- The SaaS-card kit: identical rounded cards with identical soft shadows.
- All-caps tracked eyebrow labels above every heading; middle-dot meta strings everywhere; monospace used for every small label.
- Numbered 01/02/03 markers for content that isn't a sequence.

### 10.4 Proposed direction (starting point — refine in the design pass, but keep the intent)

- **Concept:** a settlement ledger. Calm, dense, typographic. The only saturated color on the page is _delivered value_; _claimed reputation_ is intentionally rendered dull, because that is the argument.
- **Palette (starting tokens):**
  - Base `#1E2329` graphite (not near-black), surface `#272D34`, hairline `#3A424B`
  - Text `#EEF1F4`, secondary text `#A7B0BA`
  - **Delivered** `#3FD39B` (the one saturated color)
  - **Failed** `#F0626B`
  - Claimed/reviews `#8B94A0` (deliberately muted)
  - Link `#8FB6FF`
- **Type:** one family with true tabular figures for everything (e.g., Geist, IBM Plex Sans, or Instrument Sans — pick one with tabular numerals); numbers set in tabular figures within the same family rather than switching to a monospace. A monospace is allowed in exactly one place: the `TakerConsole`, because it _is_ a terminal.
- **Layout:** left-aligned, single column at the top (AgentsTable with GapBars full-width), two-column below (FillsFeed left, TakerConsole right). Detail view slides in as a right-side panel, never a modal.
- **The hero:** not a headline — the AgentsTable itself, with the two GapBars for Alice and Mallory. The page opens on the argument.
- **Motion:** page load — nothing. Bob choosing — the winning row lifts 4px and its GapBar's delivered segment extends to the new value over ~600ms; a new row slides into FillsFeed. Failed fill — the FAILED badge appears with a single 120ms scale-in, then holds. Respect `prefers-reduced-motion`.
- **Empty and error states** are instructions: "No fills yet — run `pnpm alice ship`", "Subgraph 40 blocks behind — wait or check Studio".

### 10.5 Screens (wireframes)

**Screen A — Agents (primary, opens the demo)**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Proof of Fill                                 Base Sepolia   ● live  Studio ↗│
│ Reputation you had to pay for.                                               │
├──────────────────────────────────────────────────────────────────────────────┤
│ Agent            Reviews (ERC-8004)      Proof of Fill                       │
│                                                                              │
│ Alice MM #1042   ★ 4.9 · 20 reviews ▾    $31,240 honored   12 ✓   0 ✗       │
│                  claimed ░░░░░░░░░░░░    delivered ████████████████  verify ↗│
│                                                                              │
│ Mallory #1043    ★ 4.9 · 20 reviews ▾    $0 honored        0 ✓    0 ✗       │
│                  claimed ░░░░░░░░░░░░    delivered                  no record│
│                                                                              │
│ Bob #1044        —                        taker                              │
├───────────────────────────────────┬──────────────────────────────────────────┤
│ Fills                              │ Bob                                     │
│ 12:04  Alice ← Bob  1.000 WETH  ✓  │ > buy 1 WETH with USDC        [Run]     │
│ 11:58  Alice ← Bob  0.992 WETH  ✓  │                                         │
│ …                                  │                                         │
└───────────────────────────────────┴──────────────────────────────────────────┘
```

Clicking `20 reviews ▾` on Mallory opens the ReviewersDrawer inline: 20 addresses and the line _"All 20 funded by 0x7a…f3 in block 41,882,110."_

**Screen B — Agent detail (right-side panel)**

```
┌──────────────────────────────────────────────┐
│ Alice MM #1042   0x3f…9c1e   ERC-8004 · Base  ✕│
├──────────────────────────────────────────────┤
│ Reviews (fakeable)     Proof of Fill          │
│ ★ 4.9 · 20             $31,240 honored        │
│ cost to fake: $0.0027  12 ✓  0 ✗  score 31,240│
│                        ▁▂▃▅▆▇█ last 30 days   │
├──────────────────────────────────────────────┤
│ Fills                                         │
│ time   taker  in         out        status  tx│
│ 12:04  0xb0b  2,500 USDC 1.000 WETH ✓  0x9d…41│
├──────────────────────────────────────────────┤
│ Attestations (Validation Registry)            │
│ #12  fill 0x9d…41  ok  validator 0xatt  0x55…│
├──────────────────────────────────────────────┤
│ Active strategy on Aqua                       │
│ WETH/USDC  committed 5 WETH / 10,000 USDC     │
│ [ReputationGate min 1000, refuse <100] [XYC]  │
│ [Fee 30bp]                                    │
│ wallet now 4.008 WETH / 12,480 USDC           │
│ never deposited ●                             │
└──────────────────────────────────────────────┘
```

**Screen C — Taker console (three scenarios)**

```
> querying subgraph … 2 candidates
  agent     reviews     honored    failed   score
  Alice     ★4.9 (20)   $31,240    0        31,240
  Mallory   ★4.9 (20)   $0         0        0
> reasoning
  Choosing Alice. 12 honored fills worth $31,240, no failures.
  Mallory has identical reviews but no record of delivering.
> quote   1 WETH = 2,504.11 USDC
> swap    0x9d…41 ✓ confirmed · 1.000 WETH received
> attest  Validation Registry #13 written · 0x61…0a
```

Scenario 2 ends in `✗ TakerBelowReputationFloor(score 0, floor 100)` in the failed color. Scenario 3 (after `alice betray`) ends in a revert, and Screen A's Alice row updates to `12 ✓ 1 ✗` with the score visibly dropping.

**Screen D — Badge (stretch):** `[ ✓ Proof of Fill · $31,240 honored · 0 failed · Base ]` as a drop-in component linking to Screen B.

### 10.6 Definition of "presentable"

Claude Code should take a screenshot of Screen A in the prepared demo state and check: Can someone who has never heard of the project tell in ten seconds that Alice and Mallory look the same by reviews and completely different by delivery? Is the delivered value the only saturated thing on screen? Are the failure badges impossible to miss? Is every number a link? If any answer is no, iterate before moving on.

---

## 11. Milestones (9 days)

| Day | Deliverable                                                                        | Done when                         |
| --- | ---------------------------------------------------------------------------------- | --------------------------------- |
| 1   | §14 verification report; repo + submodules compile; Aqua deployed + verified (9.1) | manifest has Aqua                 |
| 2   | ProofOfFillScore (9.3) + Router/ReputationGate (9.2) tested and deployed           | `forge test` green                |
| 3   | FillAndRevert proof (9.4); revert selector documented                              | test green                        |
| 4   | 8004 registries + seed (9.5); Mallory Sybil set (9.9)                              | 3 agents + 20 reviews on explorer |
| 5   | Subgraph on Studio (9.6); `Candidates` works                                       | Studio URL live                   |
| 6   | Alice ships (9.8); Bob swaps (9.10); fills in subgraph                             | tx in README                      |
| 7   | Attestor (9.7); gate observed refusing                                             | attestation + refusal txs         |
| 8   | Dashboard (9.11) + demo orchestration (9.12); two dry runs                         | rehearsal recorded                |
| 9   | Video, README, submissions (9.13)                                                  | submitted                         |

Cut list if behind: Badge, sparkline, mainnet subgraph, maker re-ship loop.

---

## 12. Submission checklist

**1inch — Build an Aqua App**

- [ ] Official Aqua contracts used (unmodified bytecode redeployed to Base Sepolia; hash comparison documented).
- [ ] Modified SwapVM redeployed with `ReputationGate` appended (call out as the permitted "redeployment of a modified SwapVM").
- [ ] On-chain token transfers shown in the demo with explorer.
- [ ] Proper git history (no single-commit dumps).
- [ ] SwapVM usage highlighted.

**The Graph — Best AI Tooling or AI Use Case (From Scratch)**

- [ ] The Graph is load-bearing (delete it and Bob can't score anyone).
- [ ] Live data from Subgraph Studio with an API key; Studio page shown in video.
- [ ] Meaningful work with the data (reasoning + decision + execution).
- [ ] Open-source, README, 2–4 min video.
- [ ] "Start Fresh" pool selected; no pre-existing project code.

---

## 13. Risks and fallbacks

| Risk                                         | Fallback                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------- |
| Can't extend the SwapVM opcode table cleanly | Fork the router and add the instruction inline — still a "modified SwapVM redeployed" |
| SDK can't encode the custom opcode           | Hand-encode program bytes; unit-test against the Solidity decoder                     |
| Subgraph can't see reverts                   | §9.6 fallback chain: router events → attestor receipt scan → taker-reported           |
| No 8004 registries on Base Sepolia           | Deploy reference implementation; document                                             |
| Resolver-only restriction in the redeploy    | Remove/relax in our router copy; document why                                         |
| Studio indexing lag during recording         | Pre-run fills 30+ min before; only the three live scenarios happen on camera          |
| LLM picks the wrong agent on camera          | Hard rule in code guarantees the choice; the LLM only writes the explanation          |
| Dashboard looks generic                      | Run the §10 self-critique; the GapBar must be the memorable element                   |

---

## 14. Verification tasks — do these first, report back

1. `1inch/aqua/src/Aqua.sol`: exact event signatures for ship/dock/pull/push; the revert path when `pull` fails; whether any resolver restriction lives here.
2. `1inch/swap-vm`: `src/routers/AquaSwapVMRouter.sol`, `src/libs/VM.sol`, `src/instructions/Controls.sol`, `src/instructions/Fee.sol` — context struct fields, how an instruction reads taker address and adjusts amounts, how the opcode table is assembled/extended, where resolver gating lives.
3. `docs/PROGRAMS.md`: simplest AMM program shape; expected position for a Controls-style instruction.
4. `@1inch/swap-vm-sdk` and `@1inch/aqua-sdk` on npm: versions, exports, whether custom instructions can be encoded.
5. EIP-8004: Identity/Reputation/Validation function + event signatures; **current Validation Registry deployment status on Base mainnet and Base Sepolia**; reference implementation repo.
6. Subgraph Studio: `base-sepolia` support and any required `startBlock`.
7. How ArcBook (github.com/Ryad2/liquid_OB) and Votive (github.com/resistingdestiny/wishing-well-votive) redeployed Aqua/SwapVM to Base Sepolia and appended opcodes — copy the pattern, not the code.
8. Confirm ETHOnline 2026 deadlines for both partner submissions.

---

## 15. The demo (3 minutes)

Screen recording: dashboard left, console right. Plain-language narration.

- **0:00–0:20 The problem.** Screen A. Alice and Mallory both ★4.9 from 20 reviews. "Two agents, same reputation. One is lying." Expand Mallory's reviewers: 20 wallets, one funder, one block. "Reviews are free, so they're worthless — a July study found nine in ten reviewers on Base are Sybils."
- **0:20–0:50 What can't be faked.** Console shows Alice's earlier `ship` and "wallet balance unchanged: 5 WETH". "On Aqua, Alice posts an offer without depositing. When someone takes it, real tokens leave her wallet. If she was lying, the trade fails on-chain. Either way, there's a receipt." Fills feed: 12 honored, $31k. Mallory: nothing.
- **0:50–1:30 The receipt goes where agents look.** Click verify → BaseScan → Validation Registry entry → fill tx. "Every fill is written into Alice's ERC-8004 profile as a verified fact. That's Proof of Fill: the Reputation Registry, except it cost money to earn." Flash the Subgraph Studio page: "indexed live on The Graph."
- **1:30–2:15 Bob chooses.** Run Bob. Candidate table, reasoning, quote, swap, tx. BaseScan shows 1 WETH leaving Alice's wallet. "Real transfer, from a wallet, no vault."
- **2:15–2:45 The gate.** Zero-score taker → `TakerBelowReputationFloor`. "Alice's strategy includes a custom SwapVM instruction that refuses takers with no track record. Makers can enforce the score at quote time."
- **2:45–3:00 The failure case and close.** `alice betray` → Bob refused → Alice `12 ✓ 1 ✗`, score drops. "When a maker reneges, that's on the record too. Reputation you had to pay for. Built on 1inch Aqua and The Graph. Next: takers pay per quote via x402."
- End card: repo, addresses, subgraph URL.

---

## 16. Objections and the pitch

**Wash trading?** Costs gas + fees + capital per self-fill; on mainnet the taker must be a KYC'd resolver. A fake review costs $0.0027. We claim manipulation costs more than it's worth (C4), not that it's impossible.
**Only measures trading?** Yes — financial reliability. Any agent can earn it in an afternoon, and any agent about to pay another should want to see it.
**Why not x402 payment proofs?** They prove the buyer paid. Fills prove the seller delivered.
**Centralized attestor?** Trusted updater in the prototype; every attestation points at a tx anyone can verify; score is re-derivable from public data.
**Cross-chain?** Aqua is at one address on 13 chains; USD honored is the same unit everywhere — the thing reviews can't do (ρ = 0.05).

**60-second pitch:** "AI agents are paying each other now — over a hundred million x402 transactions on Base. Before an agent pays, it checks the other agent's ERC-8004 reputation. The first empirical study of that registry found that on Base ninety percent of reviewers are Sybils and a fake review costs a quarter of a cent. Proof of Fill replaces reviews with something you can't fake. An agent makes a market from its own wallet on 1inch Aqua — no deposit. Every time another agent takes its quote, real tokens move; if the agent lied, the trade reverts on-chain. We index every outcome with The Graph and write it into the agent's ERC-8004 profile as a verified attestation. The score says how much value this agent has actually delivered and how many times it failed to. Reputation you had to pay for."

**Business model (for the README's "what's next"):** score API for agent frameworks and wallets (on-chain `scoreOf()` stays free); take on x402-paid quotes later; 1inch DAO Aqua Incubator revenue-share on strategies using `ReputationGate` (the incubator has $436k unallocated and asks for new SwapVM instructions).

---

## 17. Sources

- Xiong et al., _Can Trustless Agents Be Trusted? An Empirical Study of the ERC-8004 Decentralized AI Agent Ecosystem_, arXiv:2606.26028 v2, July 8, 2026 — all registry statistics, C1–C4 framework, manipulation costs, Sybil rates, cross-chain correlation, Validation Registry status.
- ERC-8004 draft: https://eips.ethereum.org/EIPS/eip-8004
- Eco docs on ERC-8004 — launch, integrators, v2 roadmap, Base Sepolia reference deployments.
- Forbes, Feb 5, 2026; Everstake, Feb 25, 2026 — adoption figures.
- Chainalysis, June 3, 2026 — x402 on Base; Keyrock via Analytics Insight — agent settlement mix.
- 1inch Aqua README/deployments; 1inch SwapVM README; `@1inch/swap-vm-sdk` README; The Block (July 28, 2026) on Aqua launch and resolver-restricted execution.
- 1inch DAO Aqua Revenue Stream Incubator (1IP-93) and Q2 2026 report, gov.1inch.network.
- ETHOnline 2026 sponsor pages (1inch, The Graph) — qualification requirements.
- awesome-erc8004; BNB Chain forum (Global Score Agent); research-erc8004.vercel.app (Praxis) — competitor inventory.
