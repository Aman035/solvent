# Solvent

**On-chain market making that never quotes more than it can settle.**

In options, selling what you don't hold is called *writing naked*. On
[1inch Aqua](https://github.com/1inch/aqua), every quote can be naked — and neither the
maker's own strategies nor the takers filling them have any way to know.

Solvent makes Aqua positions aware of their own balance sheet: quotes that widen as the
maker's book thins, a hard floor below which they decline instead of failing, and a
cross-chain index of every maker's true backing.

---

## The problem

Aqua is a shared liquidity layer. A market maker commits inventory to a strategy
**without depositing it** — tokens stay in the maker's wallet, and Aqua pulls them only
at the moment a taker fills. No custody, no vault, no idle capital.

The headline benefit is that **one balance can back many strategies at once**. 1inch's
own worked example: a $100,000 balance supporting three positions that collectively quote
$300,000. Genuine capital efficiency — and the maker's losses stay capped, since nothing
is borrowed and the protocol can never take on bad debt.

But it has a structural consequence:

> **Every Aqua maker is running a fractional-reserve book, and no strategy knows about
> the others.**

SwapVM — the bytecode VM that executes Aqua strategies — has no concept of the maker's
aggregate position. Each strategy quotes as if it alone owned the whole wallet. Aqua's
`ship()` performs no aggregate check: no sum across strategies, no comparison against
balance or allowance. And the whitepaper is explicit about what happens as commitments
drift away from backing (emphasis ours):

> *"When a Maker's actual wallet balance falls below their virtual balance commitments,
> strategies become illiquid — trades cannot execute because pull operations will revert.
> Importantly, **the AMM continues quoting prices based solely on virtual balances without
> checking real balances or allowances**."*

> *"**While Aqua doesn't automatically pause illiquid positions, Makers are strongly
> recommended to manually dock strategies** that become chronically underfunded to prevent
> accumulating unfavorable price exposure."*

The venue keeps quoting. The protocol won't pause. The prescribed remedy is a human,
watching, by hand.

## Who gets hurt

**Makers.** An illiquid strategy keeps quoting through price moves it cannot trade
against. The whitepaper compares the result to impermanent loss: when liquidity returns,
*"the first executable trade locks in those adverse price movements."* The recommended
defence — manual monitoring of a book that was designed to be passive — does not scale
past a handful of strategies.

**Takers, especially automated ones.** An unbacked quote is indistinguishable from a
backed one until you spend gas trying to fill it. A human might notice a sketchy maker;
an agent routing purely on price will hit the same phantom quote again and again. As
agents become the dominant taker population, "just eyeball it" stops being an answer.

**Aggregators and solvers.** Unbacked quotes are often the *best-priced* quotes — stale
positions quote straight through market moves. They win the route, then revert. Fill
rate is the metric aggregators live and die by.

**The venue.** None of this is bad debt, but all of it is reputation. A venue whose
quotes can't be trusted pays for it in routing priority.

## Is this pain real?

Three layers of evidence, from designed-in to live-on-mainnet:

**1. It is designed in.** The whitepaper quotes above are 1inch describing their own
trade-off: capital efficiency purchased with quote reliability, mitigation left to
operators.

**2. It is demonstrable on-chain.**
[`contracts/test/FractionalReserve.t.sol`](contracts/test/FractionalReserve.t.sol)
proves the mechanics against the real Aqua contracts:

```
one wallet holding 10 WETH, shipping three strategies:

  strategy A   advertises 10 WETH      ← individually backed ✓
  strategy B   advertises 10 WETH      ← individually backed ✓
  strategy C   advertises 10 WETH      ← individually backed ✓
  ──────────────────────────────────────────────────────────
  advertised   30 WETH   ·   held 10 WETH   ·   reserve 33%
```

Every strategy passes a per-strategy check; only the aggregate reveals the position. The
second test shows where the cost lands: a taker fills strategy A and drains the wallet —
then a taker arriving at strategy B **reverts through no fault of their own**, against a
position still advertising 10 WETH it cannot deliver.

**3. It is live.** Aqua launched in July 2026 and is deployed at **identical addresses
on Base, Arbitrum and Optimism**. Sampling its first weeks on Base (~63k blocks): 232
protocol events — 120 pulls, 87 pushes, 13 ships, 12 docks — from **18 distinct
makers**, with activity on all three chains. The maker population is early, which is
precisely the point: the failure mode compounds with adoption, and the fix should exist
before the fleet grows, not after the first run on a maker's book.

There is also a century of precedent for the fix. Professional market makers have skewed
quotes against their own inventory since long before Avellaneda–Stoikov formalised it in
2008 — inventory-aware pricing is table stakes everywhere *except* on-chain, where
strategies are bytecode and, until now, blind to their own balance sheet. Aqua adds a
dimension TradFi doesn't even have: the same inventory pledged to N books simultaneously.

---

## What Solvent does

Solvent makes an Aqua position **aware of its own balance sheet**, in bytecode. Three
parts:

### 1 · `SolvencySkew` — quotes that widen as the book thins

A custom SwapVM instruction. The maker's *utilisation* — total commitments across every
strategy, divided by what the wallet actually holds and has approved — feeds directly
into pricing:

```
utilisation 40%   →  quote at fair price
utilisation 80%   →  spread widens          (scarce inventory costs more)
utilisation 95%   →  spread widens sharply  (you are nearly a phantom)
```

This is the economically correct behaviour — the last unit of a shared balance sheet is
worth more than the first — and it is the standard professional response to inventory
risk, expressed for the first time as an on-chain instruction.

### 2 · `SolvencyFloor` — refuse before you fail

A hard floor. Below a maker-chosen reserve ratio, the strategy **declines at quote
time** — cheaply, honestly, visibly — instead of failing at settlement after a taker has
committed gas. This is the automatic pause the whitepaper leaves manual, and because it
lives in the program bytes, **any taker can verify the covenant before trading**. A
maker who ships a floor is making a checkable promise: *my quotes are covered, and I
stop quoting before that stops being true.* Those quotes are worth more, and should
route better.

### 3 · The balance-sheet index — the number nothing on-chain can compute

Both instructions need one number: the maker's aggregate commitment. **Aqua cannot
produce it.** Balances are stored per `(maker, app, strategyHash, token)` with no
enumeration, no per-maker total, and no event carrying the aggregate. The only way to
know a maker's book is to **replay every `Shipped`, `Docked`, `Pulled` and `Pushed`
since genesis** and reconstruct it.

That is an indexing problem, and it is why Solvent is built on The Graph rather than
merely using it: one subgraph pipeline, deployed **unchanged** against the identical
Aqua contracts on Base, Arbitrum and Optimism, maintaining every maker's live balance
sheet. An attestor publishes each maker's aggregate on-chain, where the opcodes read it;
anyone can recompute the same number from the same public index.

One schema, one pipeline, three chains, one query pattern:
*"show me every maker whose commitments exceed their backing — anywhere."*

### And the settlement record

Solvency says whether a maker *can* deliver. The record says whether they *do*: honoured
fills versus broken promises (a reverted fill destroys its own logs, so Solvent re-emits
failures on-chain, citing the reverted transaction anyone can check), discounted by
counterparty concentration so self-dealt volume scores zero.

We also cross-referenced makers against ERC-8004, the on-chain agent reputation
standard, via a second standardized multi-chain module. Finding: two agents can hold
**identical five-star reputations** — same rating, same reviewer count — while one has
settled thousands of dollars and the other has settled nothing. Reviews are free;
balance sheets are not. That contrast is one query in Solvent's schema.

---

## The demo moment

Three strategies from one wallet, quoting side by side.

1. All three quote at fair price — the book is fully backed.
2. A taker fills strategy A, consuming half the wallet.
3. **Strategies B and C widen their own spreads, live** — no keeper, no manual dock; the
   position repriced itself.
4. Another fill takes the book below its floor. B and C now **refuse at quote time** —
   where before, they would have kept quoting and failed at settlement, burning the
   taker's gas.

A position that protects its maker, warns its takers, and prices its own risk.

---

## Landscape

| Who | What they measure | The gap |
| --- | --- | --- |
| Exchange proof-of-reserves | custodial solvency, periodically attested | custody-only; meaningless where the maker keeps the keys. Solvent is proof-of-reserves for makers who *don't* deposit — continuous, not quarterly |
| Risk platforms (Gauntlet, Chaos Labs, Chainlink PoR) | protocol-level parameters, custodial reserves | no concept of per-maker, approval-backed liquidity |
| Aqua tooling (order books, strategy managers) | strategy construction and routing | none model maker solvency; none see the aggregate book |
| ERC-8004 reputation scorers | free-form review aggregation | measures claims; 90.6% of reviewers on Base show coordinated Sybil patterns (arXiv:2606.26028) |
| The whitepaper's own remedy | "manually dock" | a human, watching, by hand |

Nobody prices an on-chain maker's solvency, because before Aqua the question didn't
exist: every other venue takes custody, so backing is 1.0 by construction. **Aqua
created the category by deleting custody. Solvent is the first entrant.**

## Why now

1. **The venue is weeks old** and already multichain at identical addresses. The
   primitive should exist before the maker population scales.
2. **The remedy is documented as manual** by the protocol's own authors.
3. **The takers are becoming machines.** Agents can't eyeball counterparty risk; they
   need it priced into the quote or published in the index. Solvent does both.

---

## Status

**Running today, on Base Sepolia (all contracts verified):** the extended SwapVM router
built on 1inch's own extension pattern — with **35 of 1inch's unmodified Aqua tests
passing against it** — plus the settlement-record pipeline end to end: fills indexed,
broken promises recorded on-chain with the reverted tx as evidence, scores derived from
the index and enforced by a working gate instruction at quote time. 124 Solidity tests,
including the fractional-reserve proof and score invariants over 4,096 fuzzed calls.

**In progress:** the `SolvencySkew` and `SolvencyFloor` instructions, per-maker
balance-sheet aggregation in the subgraph, and the mainnet pipeline against real Aqua on
Base, Arbitrum and Optimism.

**Measured, and kept honest:** we attacked our own scoring system and published the
numbers, including the inconvenient ones — faking fills costs *less gas* than faking
reviews ($0.11 vs $0.57); what it actually costs is **capital** ($45,000 of real
inventory vs $0). See [`docs/COST_TO_FAKE.md`](docs/COST_TO_FAKE.md).

```bash
pnpm install && cp .env.example .env
pnpm verify:all        # 15 live checks against the deployment
pnpm dash              # the ledger
pnpm alice status      # a maker's promised vs held
pnpm demo:run          # honoured fill · quote-time refusal · broken promise
```

## Attribution

Powered by Aqua and SwapVM — © Degensoft Ltd; licences preserved in `LICENSES/`.
ERC-8004 reference implementation:
[ChaosChain/trustless-agents-erc-ri](https://github.com/ChaosChain/trustless-agents-erc-ri) (CC0).
