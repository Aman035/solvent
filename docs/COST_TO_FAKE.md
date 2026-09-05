# Cost to fake

**Measured, not asserted.** Every number below comes from transactions actually executed
on Base Sepolia by `scripts/attack/`. Raw data: `docs/cost-to-fake.json`,
`docs/cost-to-fake-reviews.json`.

Assumptions, stated openly: ETH at $3000, Base L2 gas at
0.03 gwei. **Testnet gas is free**, so every dollar figure is a
mainnet-equivalent computed from real measured gas — never a testnet cost dressed up as a
real one.

---

## The two attacks, side by side

| | Fake **reviews** (ERC-8004) | Fake **fills** (Proof of Fill) |
| --- | --- | --- |
| What it buys | ★5.00 from 20 reviewers | $2,675 of "delivered" volume |
| Transactions | 40 | 15 |
| Gas used | 6,377,600 | 1,258,026 |
| Gas cost (mainnet-equiv) | **$0.574** | **$0.1132** |
| **Capital required** | **$0** | **$45,000** |
| Prior interaction required | none | a real, settled trade per fill |
| Stake required | none | the entire inventory, held throughout |
| Resulting Proof-of-Fill score | **0** | 1780 |

### The finding

**Gas is not the defence.** Both attacks cost cents in gas — roughly $0.57 versus $0.11.
Anyone claiming fills are expensive *because of gas* is wrong.

**Capital is the defence.** A perfect review score costs
$0.29 and requires the attacker
to hold **nothing**. Manufacturing $2,675 of fills required
**$45,000 of real inventory**, held for the duration and
exposed to real settlement. That is the whole difference, and it is a difference of kind:
reviews are free speech, fills are collateralised speech.

---

## The structural defence: concentration

Volume alone buys nothing. The Herfindahl diversity term means a wash trader who only ever
trades with itself has HHI = 1, diversity = 0, and therefore a score of **exactly zero** —
regardless of volume. Measured in this run: **3 puppets → score 1780;
the same volume through 1 puppet → score 0.**

How much of a $10,000 honest score can an attacker reach by adding sock puppets?

| Sock puppets | Diversity | Score | % of an honest maker |
| ---: | ---: | ---: | ---: |
| 1 | 0.00% | **0** | 0.0% |
| 2 | 50.00% | **5000** | 50.0% |
| 3 | 66.70% | **6670** | 66.7% |
| 5 | 80.00% | **8000** | 80.0% |
| 10 | 90.00% | **9000** | 90.0% |

Each additional puppet has to be funded, approved, and traded through — real transactions,
real inventory routed through each — while only partially lifting the cap.

---

## What this does NOT claim

1. **Faking is not impossible.** An attacker with genuine capital and several funded
   counterparties can manufacture a respectable score. Concentration limits are a
   *mitigation*, not a solution — the Sybil problem is not solved here.
2. **On a testnet, none of this costs anything.** Our demo runs on Base Sepolia where gas
   is free and tokens are mintable. The economic argument holds on mainnet, where the
   inventory has to be genuinely acquired.
3. **The resolver restriction is removed in our deployment.** On 1inch's mainnet Aqua,
   swap execution is limited to verified resolvers, which raises the bar further. We do
   not get that benefit on our own redeploy and do not claim it.
4. **Capital is recoverable.** A wash trader gets its inventory back, minus fees and gas.
   The cost is opportunity cost and exposure, not destruction.

The honest claim is narrow and defensible: **Proof of Fill moves the cost of a fake
reputation from approximately zero to approximately the capital you must genuinely put at
risk — and it makes the shape of a fake (counterparty concentration) directly measurable.**
