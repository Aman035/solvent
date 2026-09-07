# Plimsoll — the load line for shared liquidity

*Working positioning document. Supersedes the framing in `handover_doc.md` §1–§5.*

---

## 1. The problem

1inch Aqua is a **shared liquidity layer**: a market maker commits inventory to a strategy
without depositing it. Tokens stay in the maker's own wallet; Aqua records a *virtual
balance* and pulls the tokens only when a taker fills. No custody, no vault.

The design's headline benefit is that **one balance can back many strategies at once**.
1inch's own README markets exactly this:

> *"a registry-based allowance system where liquidity providers maintain a single token
> approval while distributing virtual balances across multiple strategies"*

And their whitepaper gives the worked example: **a $100,000 balance supporting three
positions that collectively quote $300,000.**

That is real capital efficiency, and 1inch is right that the maker's *exposure* is capped
by holdings — nothing is borrowed, and the protocol cannot take on bad debt.

**But the quotes are not capped.** From the Aqua whitepaper, emphasis ours:

> *"When a Maker's actual wallet balance falls below their virtual balance commitments,
> strategies become illiquid — trades cannot execute because pull operations will revert.
> **Importantly, the AMM continues quoting prices based solely on virtual balances without
> checking real balances or allowances**, preserving price continuity."*

And the prescribed remedy is manual:

> *"**While Aqua doesn't automatically pause illiquid positions, Makers are strongly
> recommended to manually dock strategies** that become chronically underfunded** to
> prevent accumulating unfavorable price exposure."*

So the protocol authors have named the gap themselves: **a maker can be quoting liquidity
they cannot deliver, the protocol will not stop them, and the fix depends on the maker
noticing and acting.**

### It is not theoretical

`contracts/test/FractionalReserve.t.sol` establishes it on-chain:

- One wallet holding **10 WETH** backed **three strategies**, each advertising the full
  10 WETH. Advertised **30**, held **10** — a **33% reserve ratio**.
- **Every strategy passes a per-strategy backing check.** Only the aggregate reveals it.
- A taker filling strategy A drains the wallet. A taker arriving at strategy B is
  **reverted having done nothing wrong**, against a position still advertising 10 WETH.

That last point is the one that matters: the cost lands on a third party.

---

## 2. Who is hurt, and how

| | Harm | Severity |
| --- | --- | --- |
| **Takers / agents** | Gas burned on quotes that cannot fill; failed routes; no pre-trade signal distinguishing a real quote from an unbacked one | **High** — this is the direct cost, and it is invisible before the attempt |
| **Makers** | Quotes keep firing while illiquid. The whitepaper: adverse price movements get locked in, *"similar to impermanent loss"*, and the first executable trade when liquidity returns realises them | **Medium–high** — self-inflicted but hard to notice |
| **Aggregators / solvers** | Route quality degrades. An unbacked quote looks identical to a backed one at quote time, so it wins the route and then fails | **High** — and it scales with Aqua adoption |
| **Aqua itself** | No protocol insolvency (correctly noted in the whitepaper) but a worse fill-rate reputation as a venue | **Medium** |

Note what this is **not**: it is not a bug, not an exploit, and not bad debt. It is a
deliberate design trade — capital efficiency purchased with quote reliability — where the
mitigation was left to operators.

---

## 3. Why nobody can see it today

Detecting under-backing requires answering one question:

> For maker M and token T, what is the **sum of every virtual balance M has committed
> across every strategy on every app**, compared to what M actually holds and has approved?

That is not an RPC call. Aqua stores balances keyed
`_balances[maker][app][strategyHash][token]` — you can read one strategy if you already
know its hash, but there is no enumeration, no per-maker total, and no event that carries
the aggregate. `ship()` performs **no aggregate check**: no sum across strategies, no
comparison against wallet balance or allowance.

The only way to compute the total is to **index every `Shipped`, `Docked`, `Pulled` and
`Pushed` event and reconstruct per-maker state**. That is what an indexer is for, and it
is why this product needs The Graph rather than merely using it.

---

## 4. What we build

**Plimsoll** — the load line for shared liquidity. Three layers, each usable alone.

### 4.1 Reserve ratio — the missing pre-trade signal

Continuously reconstruct, for every maker and token:

```
committed(M,T)  = Σ virtual balances across all strategies and apps
backing(M,T)    = min(walletBalance(M,T), allowance(M → Aqua, T))
reserveRatio    = backing / committed
```

`< 1.0` means the maker is advertising more than they can deliver. Published as a live
feed and a queryable API, so a taker or aggregator can price the risk of a quote
**before** spending gas on it.

This is **proof of reserves for on-chain market makers** — a concept exchanges already
treat as table stakes, applied to a venue that just created the need for it.

### 4.2 Solvency covenants — the automatic pause Aqua doesn't have

A custom SwapVM instruction (`ReserveGate`, opcode in the guards bank) that **refuses to
fill when its own maker's reserve ratio has fallen below a threshold the maker chose**.

The whitepaper says makers *"are strongly recommended to manually dock"*. This is that,
automatically, enforced inside the swap and verifiable by any taker at quote time.

It reframes the maker's position from a claim into a **credible commitment**:

> *"I will stop quoting before I become over-extended, and you can check that in the
> program bytes before you trade."*

A maker who publishes this earns better routing, because their quotes are worth more.
That is an incentive to adopt, not a compliance burden.

### 4.3 Settlement record — what happened when it was tested

Reserve ratio answers *can they deliver right now*. It says nothing about whether they
**do**. So we keep the delivery record too:

```
reliability = honored / (honored + 3 × failed)
diversity   = 1 − HHI over counterparties
score       = usdHonored × reliability × diversity
```

The two signals are complementary and cover each other's blind spots:

| | Answers | Fakeable | Cold start |
| --- | --- | --- | --- |
| **Reserve ratio** | can they deliver *this block*? | no — it's a balance check | works instantly |
| **Settlement record** | do they deliver when tested? | costs real capital | needs history |

A brand-new honest maker has no record but can prove 100% reserve. A well-capitalised
maker with a history of reneging shows a good ratio and a bad record. You need both.

Broken promises are recorded too: a reverted swap destroys its own logs, so the failure is
re-emitted on-chain citing the real failed transaction hash.

---

## 5. Competitors

| Category | Who | What they measure | Gap |
| --- | --- | --- | --- |
| **Exchange proof-of-reserves** | CEX PoR, Merkle/zk attestations | Custodial solvency, aggregate assets vs liabilities | Custodial venues only. On a pooled AMM the reserve ratio is trivially 1 because the pool *holds* the assets. Nobody has applied it where the maker keeps custody. |
| **ERC-8004 review scorers** | Global Score Agent, Origin DAO SDK, Praxis | Aggregate free-form feedback | Measures claims, not capacity or delivery. Sybil-dominated (90.6% on Base per arXiv 2606.26028) |
| **Capability verification** | AgentPass, Proof of Agency | One-off challenge tests | *Can* it, not *will* it, and not *can it right now* |
| **Staked validation** | ERC-8004 high-assurance tier, AVS re-execution | Task correctness, backed by stake | Expensive per task; no continuous position signal |
| **Aqua tooling** | ArcBook, Aqua0, HarvestAqua | Order books, strategy tooling | None of them model maker solvency |
| **DEX analytics** | Dune dashboards, aggregator route analytics | Volume, TVL, historical fill rate | Backward-looking and pool-centric; no per-maker reserve concept because no other venue needs one |

**Nobody is measuring whether an on-chain quote is backed**, because until Aqua the
question could not be asked: every other venue takes custody, so backing is guaranteed by
construction. Aqua created the category by removing custody.

**Closest in spirit:** exchange proof-of-reserves. Same intuition — *don't trust the
advertised number, verify the backing* — applied one layer down, to individual market
makers rather than to a custodian, and continuously rather than as a periodic attestation.

---

## 6. Why now

1. **Aqua launched July 2026** across 13 chains. Before it, no venue let a maker quote
   liquidity they did not hold, so the metric had no meaning.
2. **The gap is documented and unsolved** — by 1inch, in their own whitepaper, with a
   manual remedy.
3. **Proof-of-reserves became an expectation, not a differentiator**, through 2026. The
   concept needs no explaining; only the application is new.
4. **Agents are the takers.** An automated taker cannot "notice a maker looks sketchy" —
   it needs a machine-readable pre-trade signal or it burns gas on unbacked quotes.

---

## 7. The name

**Plimsoll.** The load line painted on a ship's hull marking the maximum safe load — if
the vessel sits below it, it is over-committed for the water it is in.

It was introduced by Samuel Plimsoll in the 1870s to stop "coffin ships": vessels
deliberately overloaded and over-insured, sent to sea by owners who profited whether or
not they arrived. The externality landed on the crew, not the owner.

The parallel is exact: **an over-committed Aqua position looks fine to its owner — exposure
is capped by holdings — while the cost of failure lands on whoever shows up to trade.**
Plimsoll's answer was a mark anyone could read from the dock. This is that mark.

It is also nautical, which sits naturally beside Aqua.

*Proof of Fill* remains the right name for the settlement-record component (§4.3).
Plimsoll is the product; Proof of Fill is one of its three signals.
