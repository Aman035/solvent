import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { type Hex } from "viem";
import { readClient, readManifest, allSybils, gql, REPO_ROOT } from "@solvent/core";

/**
 * COST-TO-FAKE: the review attack.
 *
 * Measures what it actually cost to give an agent a perfect ERC-8004 reputation, using
 * the twenty reviews already posted on-chain by scripts/seed-agents.ts. No new
 * transactions are sent: the receipts are already there, so this is measurement of a
 * real attack rather than a simulation of one.
 */

const ETH_USD = 3000;
const BASE_GAS_GWEI = 0.03;

const rd = readClient();
const m = readManifest().contracts;
const REPUTATION = m.reputationRegistry.address as Hex;

console.log(`\n╔═══════════════════════════════════════════════════════════════════════╗`);
console.log(`║  COST TO FAKE — ERC-8004 review attack                                ║`);
console.log(`╚═══════════════════════════════════════════════════════════════════════╝\n`);

// Find the NewFeedback logs this project actually produced.
const logs = await rd.getLogs({
  address: REPUTATION,
  fromBlock: BigInt(m.reputationRegistry.deployBlock),
  toBlock: "latest",
});
const feedbackTxs = [...new Set(logs.map((l) => l.transactionHash))];
console.log(`  ${logs.length} feedback events across ${feedbackTxs.length} transactions`);

let gas = 0n;
for (const h of feedbackTxs) {
  const rc = await rd.getTransactionReceipt({ hash: h! });
  gas += rc.gasUsed;
}
const perReview = feedbackTxs.length ? gas / BigInt(feedbackTxs.length) : 0n;
const gasUsd = Number(gas) * BASE_GAS_GWEI * 1e-9 * ETH_USD;
const perReviewUsd = Number(perReview) * BASE_GAS_GWEI * 1e-9 * ETH_USD;

// what those reviews bought
const d = await gql<{ agents: { id: string; reviewCount: number; reviewAvgBps: number; honoredCount: number; settlementScore: string }[] }>(
  `{ agents(where:{reviewCount_gte:20}){ id reviewCount reviewAvgBps honoredCount settlementScore } }`);

console.log(`\n  ── measured ──`);
console.log(`  reviewers         ${allSybils().length} burner wallets`);
console.log(`  total gas         ${gas.toLocaleString()}`);
console.log(`  gas per review    ${perReview.toLocaleString()}`);
console.log(`  cost on testnet   $0.00`);
console.log(`  mainnet-equiv     $${gasUsd.toFixed(4)} total · $${perReviewUsd.toFixed(5)} per review`);
console.log(`\n  ── what it bought ──`);
for (const a of d.agents) {
  console.log(`  ${a.id.slice(0, 10)}  ★${(a.reviewAvgBps / 10000).toFixed(2)} from ${a.reviewCount} reviewers` +
    `  →  ${a.honoredCount} fills, settlement score ${a.settlementScore}`);
}
console.log(`\n  Requires: no stake, no registration, no prior interaction.`);
console.log(`  This is ERC-8004 condition C3 (groundedness) failing in practice.\n`);

const out = {
  measuredAt: new Date().toISOString(),
  reviewers: allSybils().length,
  feedbackEvents: logs.length,
  totalGas: gas.toString(),
  gasPerReview: perReview.toString(),
  mainnetEquivalentUsdTotal: Number(gasUsd.toFixed(4)),
  mainnetEquivalentUsdPerReview: Number(perReviewUsd.toFixed(5)),
  capitalRequiredUsd: 0,
  agents: d.agents,
  assumptions: { ethUsd: ETH_USD, baseGasGwei: BASE_GAS_GWEI },
};
writeFileSync(resolve(REPO_ROOT, "docs/cost-to-fake-reviews.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`  → docs/cost-to-fake-reviews.json\n`);
