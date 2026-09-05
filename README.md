# Proof of Fill

**Reputation you had to pay for.**

AI agents now pay each other on-chain, and before paying they check the counterparty's
ERC-8004 reputation. That reputation is free to fabricate. The first empirical study of the
standard found that on Base **90.6% of reviewers show coordinated Sybil behaviour** and a
fake review costs a fraction of a cent (arXiv:2606.26028).

Proof of Fill replaces reviews with something that costs inventory to earn: an agent's
record of **honouring on-chain quotes with real tokens**. Agents market-make from their own
wallets on 1inch Aqua — no deposit, no vault. Every honoured fill and every broken promise
is indexed by a Graph subgraph and scored. A custom SwapVM instruction lets makers enforce
that score at quote time.

> Two agents can have identical five-star reputations. Only one of them has ever delivered
> anything. This tells them apart.

---

## The demo in one screenshot

![Settlement ledger](docs/screenshots/ledger.png)

Alice and Mallory carry **byte-identical review records** — ★5.00 from the same 20
reviewers. The ledger separates them on the only axis that costs anything: Alice's
delivery channel is full, Mallory's is empty.

---

## What's live on Base Sepolia

| Contract | Address | |
| --- | --- | --- |
| Aqua | [`0x525bebb9c5b4dad791402923e344b360bf6ab6a2`](https://sepolia.basescan.org/address/0x525bebb9c5b4dad791402923e344b360bf6ab6a2#code) | official 1inch source, unmodified |
| **ProofOfFillSwapVMRouter** | [`0x06ac5984d1bdd04aefd3e4e33312f30ce058462e`](https://sepolia.basescan.org/address/0x06ac5984d1bdd04aefd3e4e33312f30ce058462e#code) | official router **+ 2 custom instructions** |
| ProofOfFillScore | [`0x95908bb174224f085b0f30d6236a46b27c7a6711`](https://sepolia.basescan.org/address/0x95908bb174224f085b0f30d6236a46b27c7a6711#code) | on-chain score the opcode reads |
| ProofOfFillRecorder | [`0x1b6439b8f19e32e806d5a3cac67fdb1d9a91b1c7`](https://sepolia.basescan.org/address/0x1b6439b8f19e32e806d5a3cac67fdb1d9a91b1c7#code) | makes broken promises indexable |
| ReputationRegistryAdapter | [`0x0e673c4a4534da45652ee4c7972fd9824e507eee`](https://sepolia.basescan.org/address/0x0e673c4a4534da45652ee4c7972fd9824e507eee#code) | score by ERC-8004 agentId |
| ERC-8004 Identity | [`0xc5734c9bfc4f9d64356dea40e4fa6f8ed23f4a33`](https://sepolia.basescan.org/address/0xc5734c9bfc4f9d64356dea40e4fa6f8ed23f4a33#code) | reference impl, CC0 |
| ERC-8004 Reputation | [`0xe5e528e6a54e25df4b0e73d22c0153d6eddbef6d`](https://sepolia.basescan.org/address/0xe5e528e6a54e25df4b0e73d22c0153d6eddbef6d#code) |  |
| ERC-8004 Validation | [`0x26f213094e835ea8428fc35b27a144ab0d23563e`](https://sepolia.basescan.org/address/0x26f213094e835ea8428fc35b27a144ab0d23563e#code) | no confirmed deployment elsewhere |
| ProofOfFillHelper | [`0x804eb88104aa6315714d6dcfb1217c2a4de0e193`](https://sepolia.basescan.org/address/0x804eb88104aa6315714d6dcfb1217c2a4de0e193#code) | read-only order encoder |
| pofWETH | [`0x3ac3f85cdbd1ce973cce3e67bc3cf75b79c525c7`](https://sepolia.basescan.org/address/0x3ac3f85cdbd1ce973cce3e67bc3cf75b79c525c7#code) | demo faucet token, 18dp |
| pofUSDC | [`0x097b80a3a5e9a82c65ef934c3ea402502cdea1af`](https://sepolia.basescan.org/address/0x097b80a3a5e9a82c65ef934c3ea402502cdea1af#code) | demo faucet token, 6dp |

Every contract is verified on BaseScan. **Subgraph:**
[Studio](https://thegraph.com/studio/subgraph/proof-of-fill) ·
[query endpoint](https://api.studio.thegraph.com/query/42912/proof-of-fill/v0.4.0)

---

## How it works

```
maker ships a strategy to Aqua          tokens NEVER leave her wallet
        │                                (Aqua is a ledger, not a vault)
        ▼
taker fills it ──── honoured ──► real tokens move from the maker's wallet
        │                        Swapped + Pulled events
        └────────── broken ────► transaction REVERTS
                                 SafeTransferFromFailed (0xf4059071)
                                 …and a full revert destroys its own logs
        ▼
The Graph indexes both sides: ERC-8004 reviews AND Aqua settlement
        ▼
score = USD honoured × reliability × counterparty diversity
        ▼
ReputationGate (opcode 0x21) enforces it at QUOTE time
```

### The two custom SwapVM instructions

1inch's bounty explicitly permits redeploying a modified SwapVM and scores projects using
it higher. We added two instructions, in **reserved free slots of their family banks**, so
no official opcode index moves:

| Opcode | Instruction | Bank | Behaviour |
| --- | --- | --- | --- |
| `0x21` | `ReputationGate` | conditions & access guards | Refuses takers below a score floor. Validation-only, so it is prefix-safe and works under `staticcall` — a refusal is visible **at quote time**, before gas is spent. |
| `0xb3` | `ReputationPriceAdjuster` | rates tuning | Widens the quote instead of refusing. Mutates registers, mirroring `FeeFlatIn`'s exact-in/exact-out branches. |

The router follows 1inch's **own** extension pattern (`AquaOpcodesDebug`): override
`_runOpcode`, fall through to `super`. Nothing inherited is altered.

**Proof it changed nothing:** `contracts/test/UpstreamRegression.t.sol` imports 1inch's own
Aqua test suites unmodified and overrides exactly one function — `_deployRouter()` — to
substitute ours. **35 upstream tests pass against our router.**

---

## The score

```
reliability = honoredCount / (honoredCount + 3 × failedCount)
diversity   = 1 − HHI          (Herfindahl concentration over counterparties)
score       = honoredValueUsd × reliability × diversity
```

A maker that only trades with itself has HHI = 1, so **diversity = 0, so its score is
exactly zero** — regardless of volume. That is proven as an invariant over 4,096 calls in
`contracts/test/invariant/ScoreInvariants.t.sol`, and measured against a real wash-trading
attack in [`docs/COST_TO_FAKE.md`](docs/COST_TO_FAKE.md).

Full rationale: [`docs/SCORE_DESIGN.md`](docs/SCORE_DESIGN.md).

---

## What faking it actually costs — measured, not asserted

Both attacks were executed on Base Sepolia; gas is measured from real receipts and
converted to mainnet-equivalent.

| | Fake **reviews** | Fake **fills** |
| --- | --- | --- |
| Gas | $0.574 | $0.1132 |
| **Capital required** | **$0** | **$45,000** |
| Prior interaction | none | a real settled trade per fill |
| Resulting score | **0** | 1780 |

**Gas is not the defence** — faking fills is *cheaper* in gas than faking reviews. Capital
is. Reviews are free speech; fills are collateralised speech.

We do **not** claim faking is impossible. See the stated limitations in
[`docs/COST_TO_FAKE.md`](docs/COST_TO_FAKE.md).

---

## Run it

```bash
pnpm install
cp .env.example .env          # add an RPC, a Graph API key, and a funded key
pnpm verify:all               # 15 checks against the live deployment
```

| | |
| --- | --- |
| `pnpm dash` | the settlement ledger dashboard |
| `pnpm bob 500` | the taker agent: query The Graph → analyse → decide → swap |
| `pnpm alice status` | what a maker has promised vs what it actually holds |
| `pnpm alice betray` | move the committed inventory away — break a promise |
| `pnpm attest` | derive scores from the subgraph, write them on-chain |
| `pnpm attest:failures` | scan for reverted swaps, record them on-chain |
| `pnpm attack:all` | measure the cost of faking a reputation |
| `pnpm demo:check` | pre-flight before recording |
| `pnpm demo:run` | the three demo scenarios |

---

## Why The Graph is load-bearing

The agent's decision is derived entirely from indexed data. Its most important signal,
`REVIEW_DELIVERY_DIVERGENCE`, requires the **ERC-8004 review record joined to the Aqua
settlement record** — the subgraph maintains that join via `AgentIdLink` (agentId →
wallet), because reputation is keyed by agent id and delivery is keyed by address.

```
▸ analysing counterparties
  Alice     ★5.00 (20)   $9,708 · 14✓ 0✗    5983    TRUST
  Mallory   ★5.00 (20)   $0     · 0✓  0✗       0    AVOID
            ⚑ REVIEW_DELIVERY_DIVERGENCE — 20 reviews averaging 5.00/5, but zero delivery
```

Remove The Graph and that flag cannot be produced at all. A deterministic safety rail
guarantees the agent never selects a maker with no delivery record; the optional LLM layer
(six providers, `LLM_PROVIDER` in `.env`) narrates the analysis and degrades silently to
the deterministic path when absent.

---

## Repository

```
contracts/     Foundry — instructions, router, score, recorder, adapter, 117 tests
subgraph/      6 data sources: Aqua, our router, score, recorder, ERC-8004 ×2
packages/core/ chain-agnostic config, wallets, program encoder, score, subgraph client
agents/        maker (Alice) and taker (Bob)
services/      attestor: subgraph → score → chain, plus the failure scanner
dashboard/     the settlement ledger
scripts/       deploy, seed, verify, attack, demo orchestration
docs/          verification report, score design, cost-to-fake, submission checklist
```

## Trust assumptions

- The **attestor is a trusted updater** in this prototype. Every number it writes is
  re-derivable from the same public subgraph by anyone, and each failure it records cites a
  real reverted transaction hash that anyone can check.
- **USD valuation uses documented fixed prices** — there is no testnet oracle.
- `ReputationGate` scores `msg.sender`. A taker routing through an aggregator is scored as
  that contract, not the end user.
- The mainnet resolver restriction is **not** present on our redeploy, and we do not claim
  its benefit.

## Attribution

Powered by Aqua — © Degensoft Ltd. Powered by SwapVM — © Degensoft Ltd.
Upstream licences preserved in `LICENSES/`. ERC-8004 reference implementation:
[ChaosChain/trustless-agents-erc-ri](https://github.com/ChaosChain/trustless-agents-erc-ri) (CC0).

Built from scratch for ETHGlobal Online 2026 — **Start Fresh** pool. No pre-existing
project code was used.
