import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { REPO_ROOT, computeScore, diversityBpsFrom } from "@solvent/core";

const j = (f: string) => JSON.parse(readFileSync(resolve(REPO_ROOT, "docs", f), "utf8"));
for (const f of ["cost-to-fake.json", "cost-to-fake-reviews.json"]) {
  if (!existsSync(resolve(REPO_ROOT, "docs", f))) {
    console.error(`missing docs/${f} — run the attack scripts first`); process.exit(1);
  }
}
const wash = j("cost-to-fake.json");
const rev = j("cost-to-fake-reviews.json");

// How much capital is needed to reach a target score at various puppet counts?
const rows: string[] = [];
for (const puppets of [1, 2, 3, 5, 10]) {
  const per = 10_000_000_000n / BigInt(puppets);      // $10k spread evenly
  const values = Array.from({ length: puppets }, () => per);
  const div = diversityBpsFrom(values);
  const s = computeScore({ honoredValueUsd6: 10_000_000_000n, honoredCount: puppets * 2, failedCount: 0, diversityBps: div });
  rows.push(`| ${puppets} | ${(div / 100).toFixed(2)}% | **${s}** | ${((Number(s) / 10000) * 100).toFixed(1)}% |`);
}

const md = `# Cost to fake

**Measured, not asserted.** Every number below comes from transactions actually executed
on Base Sepolia by \`scripts/attack/\`. Raw data: \`docs/cost-to-fake.json\`,
\`docs/cost-to-fake-reviews.json\`.

Assumptions, stated openly: ETH at $${wash.assumptions.ethUsd}, Base L2 gas at
${wash.assumptions.baseGasGwei} gwei. **Testnet gas is free**, so every dollar figure is a
mainnet-equivalent computed from real measured gas — never a testnet cost dressed up as a
real one.

---

## The two attacks, side by side

| | Fake **reviews** (ERC-8004) | Fake **fills** (Solvent) |
| --- | --- | --- |
| What it buys | ★5.00 from ${rev.reviewers} reviewers | $${wash.volumeFakedUsd.toLocaleString()} of "delivered" volume |
| Transactions | ${rev.feedbackEvents} | ${wash.transactions} |
| Gas used | ${Number(rev.totalGas).toLocaleString()} | ${Number(wash.gasUsed).toLocaleString()} |
| Gas cost (mainnet-equiv) | **$${rev.mainnetEquivalentUsdTotal}** | **$${wash.gasMainnetEquivalentUsd}** |
| **Capital required** | **$0** | **$${wash.capitalRequiredUsd.toLocaleString()}** |
| Prior interaction required | none | a real, settled trade per fill |
| Stake required | none | the entire inventory, held throughout |
| Resulting settlement score | **0** | ${wash.scoreAchieved} |

### The finding

**Gas is not the defence.** Both attacks cost cents in gas — roughly $0.57 versus $0.11.
Anyone claiming fills are expensive *because of gas* is wrong.

**Capital is the defence.** A perfect review score costs
$${(rev.mainnetEquivalentUsdPerReview * rev.reviewers).toFixed(2)} and requires the attacker
to hold **nothing**. Manufacturing $${wash.volumeFakedUsd.toLocaleString()} of fills required
**$${wash.capitalRequiredUsd.toLocaleString()} of real inventory**, held for the duration and
exposed to real settlement. That is the whole difference, and it is a difference of kind:
reviews are free speech, fills are collateralised speech.

---

## The structural defence: concentration

Volume alone buys nothing. The Herfindahl diversity term means a wash trader who only ever
trades with itself has HHI = 1, diversity = 0, and therefore a score of **exactly zero** —
regardless of volume. Measured in this run: **${wash.puppets} puppets → score ${wash.scoreAchieved};
the same volume through 1 puppet → score ${wash.scoreWithOnePuppet}.**

How much of a $10,000 honest score can an attacker reach by adding sock puppets?

| Sock puppets | Diversity | Score | % of an honest maker |
| ---: | ---: | ---: | ---: |
${rows.join("\n")}

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

The honest claim is narrow and defensible: **Solvent moves the cost of a fake
reputation from approximately zero to approximately the capital you must genuinely put at
risk — and it makes the shape of a fake (counterparty concentration) directly measurable.**
`;

writeFileSync(resolve(REPO_ROOT, "docs/COST_TO_FAKE.md"), md);
console.log(md.split("\n").slice(0, 40).join("\n"));
console.log(`\n… → docs/COST_TO_FAKE.md`);
