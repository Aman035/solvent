# Plimsoll

**A load line for shared liquidity.**

In the 1870s, ship owners sent overloaded vessels to sea knowing some would sink. They were
insured either way; the crew was not. Samuel Plimsoll's answer was a mark painted on the
hull — a line anyone could read from the dock that said *this vessel is carrying more than
it can safely hold.*

1inch Aqua has the same shape of problem, and no mark.

---

## The problem

Aqua is a shared liquidity layer: a market maker commits inventory to a strategy **without
depositing it**. The tokens stay in the maker's own wallet, and Aqua pulls them only when a
taker fills. No custody, no vault.

The payoff is that **one balance can back many strategies at once**. From the Aqua
whitepaper: *a $100,000 balance supporting three positions that collectively quote
$300,000.* That is genuine capital efficiency, and 1inch is right that the maker's exposure
stays capped by their holdings — nothing is borrowed, and the protocol cannot take on bad
debt.

**But the quotes are not capped.** Also from the whitepaper, emphasis ours:

> *"When a Maker's actual wallet balance falls below their virtual balance commitments,
> strategies become illiquid — trades cannot execute because pull operations will revert.
> Importantly, **the AMM continues quoting prices based solely on virtual balances without
> checking real balances or allowances**, preserving price continuity."*

> *"**While Aqua doesn't automatically pause illiquid positions, Makers are strongly
> recommended to manually dock** strategies that become chronically underfunded."*

So a maker can advertise liquidity they cannot deliver, the protocol will keep quoting it,
and the remedy depends on the maker noticing and acting by hand.

**Plimsoll is that remedy, automated.**

### It is not hypothetical

[`contracts/test/FractionalReserve.t.sol`](contracts/test/FractionalReserve.t.sol) proves
it on-chain:

```
one wallet holding 10 WETH, backing three strategies:

  strategy A   advertises 10 WETH   ← individually backed ✓
  strategy B   advertises 10 WETH   ← individually backed ✓
  strategy C   advertises 10 WETH   ← individually backed ✓
  ─────────────────────────────────────────────────────────
  advertised   30 WETH
  held         10 WETH              ← 33% reserve ratio
```

Every strategy passes a per-strategy backing check. Only the aggregate reveals the
position. And the second test shows where the cost lands: a taker fills strategy A and
drains the wallet, then **a taker arriving at strategy B is reverted having done nothing
wrong**, against a position still advertising 10 WETH it cannot deliver.

Not a bug, not an exploit, no bad debt. A deliberate trade — capital efficiency bought with
quote reliability — where the mitigation was left to operators.

---

## Why nobody can see it

Detecting this means answering one question:

> For maker M and token T, what is the **sum of every virtual balance M has committed across
> every strategy**, against what M actually holds and has approved?

That is not an RPC call. Aqua stores `_balances[maker][app][strategyHash][token]` — you can
read one strategy if you already know its hash, but there is no enumeration, no per-maker
total, and no event carrying the aggregate. `ship()` performs no aggregate check.

The only way to compute it is to index every `Shipped`, `Docked`, `Pulled` and `Pushed`
event and reconstruct per-maker state. That is why this is built on The Graph rather than
merely using it.

---

## What Plimsoll does

### 1 · Reserve ratio — the pre-trade signal that doesn't exist today

```
committed(M,T) = Σ virtual balances across all strategies
backing(M,T)   = min(wallet balance, allowance to Aqua)
reserveRatio   = backing / committed
```

Below 1.0, the maker is quoting more than they can deliver. Published live, so a taker or
aggregator can price that risk **before** spending gas on a quote that will revert.

Proof of reserves is table stakes for exchanges. Nobody had applied it to individual market
makers, because until Aqua every venue took custody and the ratio was 1 by construction.

### 2 · Solvency covenants — the automatic pause Aqua doesn't have

A custom SwapVM instruction that **refuses to fill when its own maker's reserve ratio falls
below a threshold the maker chose**. The whitepaper says makers *"are strongly recommended
to manually dock"*. This is that, automatically, enforced inside the swap and readable from
the program bytes at quote time.

It turns a claim into a commitment: *"I will stop quoting before I am over-extended, and
you can verify that before you trade."* A maker who publishes it earns better routing,
because their quotes are worth more.

### 3 · Proof of Fill — what happened when they were tested

Reserve ratio says whether a maker *can* deliver. It says nothing about whether they *do*.

```
reliability = honored / (honored + 3 × failed)
diversity   = 1 − HHI over counterparties
score       = usdHonored × reliability × diversity
```

A maker who only trades with itself has HHI = 1, so diversity 0, so **score exactly 0** —
however much volume it writes. That is an invariant, proven over 4,096 calls, not a
heuristic.

The two signals cover each other's blind spots:

| | Answers | Fakeable | Cold start |
| --- | --- | --- | --- |
| **Reserve ratio** | can they deliver *this block*? | no — it is a balance check | works instantly |
| **Proof of Fill** | do they deliver when tested? | costs real capital | needs history |

A brand-new honest maker has no record but can prove full reserve. A well-capitalised maker
with a habit of reneging shows a good ratio and a bad record. You want both.

Broken promises are recorded too — a reverted swap destroys its own logs, so the failure is
re-emitted on-chain citing the real failed transaction hash.

---

## See it

![Settlement ledger](docs/screenshots/ledger.png)

Two agents with **identical** ERC-8004 reputations — five stars from the same twenty
reviewers. The grey ticks are reviews; they look identical because they *are* identical.
The green is value that actually settled. Only one of them has ever delivered anything.

---

## What faking a reputation costs

Both attacks were executed on-chain. Gas is measured from real receipts, converted to
mainnet-equivalent.

| | Fake **reviews** | Fake **fills** |
| --- | --- | --- |
| Gas | $0.574 | $0.1132 |
| **Capital required** | **$0** | **$45,000** |
| Resulting score | **0** | 1780 |

**Gas is not the defence** — faking fills is *cheaper* in gas than faking reviews. Capital
is. Reviews are free speech; fills are collateralised speech.

We do not claim faking is impossible. The measured limits, including the inconvenient ones,
are in [`docs/COST_TO_FAKE.md`](docs/COST_TO_FAKE.md).

---

## Run it

```bash
pnpm install
cp .env.example .env      # an RPC, a Graph API key, a funded key
pnpm verify:all           # 15 checks against the live deployment
pnpm dash                 # the ledger
```

| | |
| --- | --- |
| `pnpm bob 500` | taker agent: read the index → analyse → decide → swap |
| `pnpm alice status` | what a maker has promised vs what it actually holds |
| `pnpm alice betray` | move the committed inventory away, and break a promise |
| `pnpm attest` | derive scores from the index, write them on-chain |
| `pnpm attest:failures` | find reverted swaps and put them back on the record |
| `pnpm attack:all` | measure what a fake reputation costs |
| `pnpm demo:run` | the three scenarios end to end |

---

## Live on Base Sepolia

| | | |
| --- | --- | --- |
| **SwapVM router** | [`0x06ac5984d1bdd04aefd3e4e33312f30ce058462e`](https://sepolia.basescan.org/address/0x06ac5984d1bdd04aefd3e4e33312f30ce058462e#code) | official router + our instructions |
| Aqua | [`0x525bebb9c5b4dad791402923e344b360bf6ab6a2`](https://sepolia.basescan.org/address/0x525bebb9c5b4dad791402923e344b360bf6ab6a2#code) | official source, unmodified |
| ProofOfFillScore | [`0x95908bb174224f085b0f30d6236a46b27c7a6711`](https://sepolia.basescan.org/address/0x95908bb174224f085b0f30d6236a46b27c7a6711#code) | what the opcode reads |
| ProofOfFillRecorder | [`0x1b6439b8f19e32e806d5a3cac67fdb1d9a91b1c7`](https://sepolia.basescan.org/address/0x1b6439b8f19e32e806d5a3cac67fdb1d9a91b1c7#code) | makes broken promises indexable |
| ReputationRegistryAdapter | [`0x0e673c4a4534da45652ee4c7972fd9824e507eee`](https://sepolia.basescan.org/address/0x0e673c4a4534da45652ee4c7972fd9824e507eee#code) | score by ERC-8004 agent id |
| ERC-8004 Identity / Reputation / Validation | [`0xc5734c9bfc4f9d64356dea40e4fa6f8ed23f4a33`](https://sepolia.basescan.org/address/0xc5734c9bfc4f9d64356dea40e4fa6f8ed23f4a33#code) · [`0xe5e528e6a54e25df4b0e73d22c0153d6eddbef6d`](https://sepolia.basescan.org/address/0xe5e528e6a54e25df4b0e73d22c0153d6eddbef6d#code) · [`0x26f213094e835ea8428fc35b27a144ab0d23563e`](https://sepolia.basescan.org/address/0x26f213094e835ea8428fc35b27a144ab0d23563e#code) | reference implementation, CC0 |

All verified. Subgraph: [Studio](https://thegraph.com/studio/subgraph/proof-of-fill) ·
[endpoint](https://api.studio.thegraph.com/query/42912/proof-of-fill/v0.4.0)

The router follows 1inch's own extension pattern — override `_runOpcode`, fall through to
`super` — using reserved free slots in SwapVM's banked opcode space, so no official opcode
index moves. To prove that,
[`contracts/test/UpstreamRegression.t.sol`](contracts/test/UpstreamRegression.t.sol) imports
**1inch's own Aqua test suites unmodified** and swaps in our router. All 35 pass.

---

## What to be sceptical about

- **We run on Base Sepolia, not mainnet.** Aqua is deployed on Base mainnet but is a
  developer preview: sampling its event history shows activity clustered around launch and
  effectively none since. There is no live maker population to monitor yet, so we
  demonstrate against makers we control and say so. The system is chain-agnostic —
  `TARGET_CHAIN=base` is a config change, not a rewrite.
- **The attestor is a trusted updater.** Everything it writes is re-derivable from the
  public index, and every failure it records cites a real reverted transaction anyone can
  check. It is still a trusted component.
- **USD valuation uses fixed documented prices.** There is no testnet oracle.
- The reputation gate scores `msg.sender`, so a taker routing through an aggregator is
  scored as that contract, not the end user.
- Mainnet Aqua restricts execution to verified resolvers. Our redeploy does not, and we do
  not claim that benefit.
- Proof of Fill measures **financial reliability only** — whether an agent delivers what it
  quotes. Not task quality. That narrowness is deliberate.

Full reasoning: [`docs/POSITIONING.md`](docs/POSITIONING.md) ·
[`docs/SCORE_DESIGN.md`](docs/SCORE_DESIGN.md)

## Attribution

Powered by Aqua — © Degensoft Ltd. Powered by SwapVM — © Degensoft Ltd. Upstream licences in
`LICENSES/`. ERC-8004 reference implementation:
[ChaosChain/trustless-agents-erc-ri](https://github.com/ChaosChain/trustless-agents-erc-ri), CC0.
