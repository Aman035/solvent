# Proof-of-Fill Score — Design

**Status:** V11 resolved · feeds C6 (`ProofOfFillScore`), C16 (shared TS library), C22 (cost-to-fake), C23 (simulator)

---

## 1. What this number means

**"How much value has this agent actually delivered, discounted by how often it reneged and by how concentrated its counterparties are."**

It measures **financial reliability** — does this agent honour quotes with real tokens — and nothing else. Not task quality, not correctness, not latency. That narrowness is deliberate (`handover_doc.md` §4.3).

---

## 2. Formula

```
reliability = honoredCount / (honoredCount + 3 · failedCount)      // failures weigh 3×
HHI         = Σ (valueFromCounterparty_i / totalValue)²            // Herfindahl-Hirschman Index
diversity   = 1 − HHI
score       = honoredValueUsd · reliability · diversity            // clamped to uint32
```

`honoredValueUsd` is reported **raw and separately** for display ("$31,240 honored"), so the headline stays legible while the *score* stays defensible.

### Why Herfindahl

An earlier draft used `diversity = min(distinctTakers, 5) / 5`. Modelling killed it: a self-dealing wash trader scored **6,248** while an honest small maker scored **1,000**. A flat cap lets a large fake number survive at 20%.

HHI is the standard economic measure of market concentration and it has exactly the property we need: **a single counterparty gives HHI = 1, hence diversity = 0, hence score = 0.** Trading only with yourself proves nothing, and the formula says so structurally rather than by a tuned constant.

---

## 3. Behaviour under adversarial and edge conditions

| Agent | USD | ✓ | ✗ | HHI | diversity | reliability | **Score** |
|---|---:|---:|---:|---:|---:|---:|---:|
| Alice — honest MM | $31,240 | 12 | 0 | 0.168 | 0.832 | 1.00 | **25,996** |
| Mallory — reviews only | $0 | 0 | 0 | 1.000 | 0.000 | 0.00 | **0** |
| **Wash trader — self only** | $31,240 | 12 | 0 | 1.000 | 0.000 | 1.00 | **0** |
| Wash trader — 3 sock puppets | $31,240 | 12 | 0 | 0.333 | 0.667 | 1.00 | **20,826** |
| Wash trader — 10 sock puppets | $31,240 | 12 | 0 | 0.100 | 0.900 | 1.00 | **28,116** |
| Whale, sloppy (10% fail) | $312,400 | 90 | 10 | 0.125 | 0.875 | 0.75 | **205,012** |
| Small but perfect | $1,000 | 5 | 0 | 0.200 | 0.800 | 1.00 | **799** |
| Newcomer, 1 fill | $500 | 1 | 0 | 1.000 | 0.000 | 1.00 | **0** |
| Serial reneger | $10,000 | 2 | 8 | 0.250 | 0.750 | 0.08 | **576** |

Key outcomes: self-dealing → **0**. Mallory (perfect reviews, no delivery) → **0**. A serial reneger with 10× the volume scores below an honest small maker.

---

## 4. Against the study's four conditions (arXiv 2606.26028)

| | Condition | How this satisfies it |
| --- | --- | --- |
| **C1** | Commensurability | One unit — USD of value actually delivered. Bounded and comparable across agents and chains. No free-form tags. |
| **C2** | Robustness | One record cannot move the score meaningfully: a fill contributes in proportion to its value, and concentration is penalised. Contrast the Reputation Registry's plain mean, where one record moves it. |
| **C3** | Groundedness | Every term derives from a transaction hash. The whole score is re-derivable from the subgraph by anyone. |
| **C4** | Economic soundness | Earning score costs gas, spread, and capital at risk. Faking it requires ≥2 genuinely distinct counterparties just to be non-zero, and more to be competitive. **C22 measures the real cost empirically rather than asserting it.** |

---

## 5. On-chain representation

HHI needs per-counterparty values — too expensive to keep on-chain. The **attestor computes it off-chain from the subgraph** and writes a single `diversityBps`. Anyone can re-derive it from the same public data.

```solidity
struct Score {
    uint128 honoredValueUsd6;  // 6-decimal USD
    uint32  honoredCount;
    uint32  failedCount;
    uint16  diversityBps;      // 10000 - HHI_bps, computed off-chain, re-derivable
    uint64  updatedAt;
}                              // 272 bits -> 2 storage slots

function computeScore(Score memory s) public pure returns (uint32);
```

`computeScore` is `pure` and mirrored exactly in TypeScript (C16), with a 1,000-case differential test asserting equality.

---

## 6. Known limitations — state these openly

1. **Sock puppets still work.** 3+ distinct funded counterparties score well. Concentration limits are a *mitigation*, not a solution — the real defence is economic, which is precisely why C22 measures cost-to-fake instead of asserting it.
2. **Cold start.** A new honest maker with one counterparty scores 0 and needs ≥2 distinct counterparties to register at all. Defensible, but it is a real barrier worth naming.
3. **Magnitude still dominates.** A large sloppy maker outscores a small perfect one. Arguably correct — more value genuinely delivered — but it means the score is not a pure trust ratio. The raw `reliability` term is exposed separately so consumers can threshold on it directly.
4. **USD valuation uses fixed token prices** (no testnet oracle). Documented constant.
5. **`failedCount` depends on the attestor** seeing failures. C15's on-chain `FillFailed` plus the receipt-scan backstop mitigate this.
6. **Testnet gas is free**, so on Base Sepolia the C4 cost argument is weaker than on mainnet. C22 reports mainnet-equivalent costs and says so explicitly.
