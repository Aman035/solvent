import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { computeScore, REPO_ROOT } from "@solvent/core";

// Deterministic PRNG so the fixture set is reproducible across runs and machines.
let seed = 0x9e3779b9;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];

const cases: any[] = [];

// Hand-picked edge cases first - these are the ones that matter.
const edges: [bigint, number, number, number][] = [
  [0n, 0, 0, 0],                       // nothing
  [31_240_000_000n, 12, 0, 0],         // self-dealing: diversity 0 -> score 0
  [31_240_000_000n, 12, 0, 10_000],    // perfect
  [0n, 5, 0, 10_000],                  // no value
  [1_000_000n, 0, 9, 10_000],          // failures only
  [(1n << 128n) - 1n, 1, 0, 10_000],   // overflow clamp
  [(1n << 128n) - 1n, 4_294_967_295, 0, 10_000],
  [1_000_000n, 1, 0, 1],               // minimum diversity
  [8_467_741_931n, 11, 0, 6_638],      // the live Alice values
];
for (const [v, h, f, d] of edges) cases.push({ honoredValueUsd6: v.toString(), honoredCount: h, failedCount: f, diversityBps: d });

// …then 1000 random ones across the whole domain.
for (let i = 0; i < 1000; i++) {
  const magnitude = pick([1n, 1_000n, 1_000_000n, 1_000_000_000n, 1_000_000_000_000n, (1n << 100n)]);
  cases.push({
    honoredValueUsd6: (BigInt(Math.floor(rnd() * 1e9)) * magnitude % ((1n << 128n) - 1n)).toString(),
    honoredCount: Math.floor(rnd() * 100_000),
    failedCount: Math.floor(rnd() * 1_000),
    diversityBps: Math.floor(rnd() * 10_001),
  });
}

const out = cases.map((c) => ({
  ...c,
  expected: computeScore({
    honoredValueUsd6: BigInt(c.honoredValueUsd6),
    honoredCount: c.honoredCount, failedCount: c.failedCount, diversityBps: c.diversityBps,
  }).toString(),
}));

const p = resolve(REPO_ROOT, "contracts/test/fixtures/scores.json");
writeFileSync(p, JSON.stringify({ count: out.length, cases: out }, null, 1) + "\n");
console.log(`  wrote ${out.length} score cases -> ${p}`);
console.log(`  edge samples:`);
for (const c of out.slice(0, 4)) console.log(`    usd=${c.honoredValueUsd6} h=${c.honoredCount} f=${c.failedCount} div=${c.diversityBps} -> ${c.expected}`);
