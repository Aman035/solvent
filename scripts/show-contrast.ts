import { gql, role } from "@aqua-solvent/core";

interface Row {
  id: string; agentId: string | null; reviewCount: number; reviewAvgBps: number;
  honoredCount: number; failedCount: number; honoredValueUsd6: string;
  distinctTakers: number; settlementScore: string; onChainScore: string;
}

const names: Record<string, string> = {
  [role("alice").address.toLowerCase()]: "Alice",
  [role("bob").address.toLowerCase()]: "Bob",
  [role("mallory").address.toLowerCase()]: "Mallory",
};

const { agents } = await gql<{ agents: Row[] }>(`{
  agents(where: { reviewCount_gt: 0 }, orderBy: reviewCount, orderDirection: desc) {
    id agentId reviewCount reviewAvgBps honoredCount failedCount
    honoredValueUsd6 distinctTakers settlementScore onChainScore
  } }`);

const bar = (frac: number, width = 22, ch = "█") =>
  ch.repeat(Math.max(0, Math.round(frac * width))).padEnd(width, "░");

const maxUsd = Math.max(1, ...agents.map((a) => Number(a.honoredValueUsd6) / 1e6));

console.log(`\n╔${"═".repeat(76)}╗`);
console.log(`║  PROOF OF FILL — claimed reputation vs delivered value${" ".repeat(22)}║`);
console.log(`╚${"═".repeat(76)}╝\n`);
console.log(`  ${"AGENT".padEnd(9)}${"CLAIMED (ERC-8004 reviews)".padEnd(30)}DELIVERED (Aqua fills)`);
console.log(`  ${"-".repeat(9)}${"-".repeat(30)}${"-".repeat(36)}\n`);

for (const a of agents) {
  const n = names[a.id.toLowerCase()] ?? `${a.id.slice(0, 8)}…`;
  const stars = a.reviewAvgBps / 10000;
  const usd = Number(a.honoredValueUsd6) / 1e6;
  console.log(`  ${n.padEnd(9)}★ ${stars.toFixed(2)} · ${String(a.reviewCount).padStart(2)} reviews`.padEnd(41) +
    `$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} honored · ${a.honoredCount}✓ ${a.failedCount}✗`);
  console.log(`  ${" ".repeat(9)}claimed   ${bar(stars / 5, 18, "░")}`.padEnd(41) +
    `delivered ${bar(usd / maxUsd, 18)}`);
  console.log(`  ${" ".repeat(9)}agentId ${a.agentId ?? "-"}`.padEnd(41) +
    `${a.distinctTakers} counterparties · score ${a.settlementScore} (on-chain ${a.onChainScore})\n`);
}

const alice = agents.find((a) => names[a.id.toLowerCase()] === "Alice");
const mallory = agents.find((a) => names[a.id.toLowerCase()] === "Mallory");
if (alice && mallory) {
  const same = alice.reviewCount === mallory.reviewCount && alice.reviewAvgBps === mallory.reviewAvgBps;
  console.log(`  ${same ? "⚠️  IDENTICAL on reviews" : "reviews differ"} — ★${(alice.reviewAvgBps / 10000).toFixed(2)} from ${alice.reviewCount} reviewers each.`);
  console.log(`  ✅ SEPARATED only by delivery: ${alice.honoredCount} fills vs ${mallory.honoredCount}.`);
  console.log(`     Reviews cost gas. Fills cost inventory.\n`);
}
