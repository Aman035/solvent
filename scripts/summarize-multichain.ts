/** Roll the per-chain histories into one comparable table, priced by symbol. */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { formatUnits } from "viem";
import { REPO_ROOT } from "@pof/core";

const PRICE: Record<string, number> = {
  USDC: 1, USDT: 1, "USD₮0": 1, DAI: 1, USDS: 1, USDbC: 1,
  WETH: 3000, cbETH: 3300, wstETH: 3600, cbBTC: 110000, WBTC: 110000,
};
const files: [string, string][] = [
  ["base", "docs/mainnet-history.json"],
  ["arbitrum", "docs/mainnet-history.arbitrum.json"],
  ["optimism", "docs/mainnet-history.optimism.json"],
];
const rows: any[] = [];
for (const [chain, f] of files) {
  const p = resolve(REPO_ROOT, f);
  if (!existsSync(p)) continue;
  const H = JSON.parse(readFileSync(p, "utf8"));
  const key = (o: any) => `${o.maker}|${o.token}`;
  const usdOf = (o: any) => {
    const dec = H.tokens[o.token.toLowerCase()]?.decimals ?? 18;
    const price = PRICE[o.symbol] ?? null;
    return price === null ? null : Number(formatUnits(BigInt(o.committed), dec)) * price;
  };
  const mat = H.observations.filter((o: any) => { const u = usdOf(o); return u !== null && u >= 100; });
  const under = mat.filter((o: any) => o.ratioBps < 10_000);
  const worstBy = new Map<string, any>();
  for (const o of under) {
    const k = key(o);
    if (!worstBy.has(k) || o.ratioBps < worstBy.get(k).ratioBps) worstBy.set(k, { ...o, usd: usdOf(o) });
  }
  const worst = [...worstBy.values()].sort((a, b) => b.usd * (1 - b.ratioBps / 1e4) - a.usd * (1 - a.ratioBps / 1e4))[0] ?? null;
  rows.push({
    chain, events: H.eventCounts, makers: H.makers,
    materialBooks: new Set(mat.map(key)).size,
    underBackedBooks: new Set(under.map(key)).size,
    makersUnderBacked: new Set(under.map((o: any) => o.maker)).size,
    worst: worst ? { maker: worst.maker, symbol: worst.symbol, usd: Math.round(worst.usd), ratioPct: +(worst.ratioBps / 100).toFixed(1) } : null,
  });
}
writeFileSync(resolve(REPO_ROOT, "docs/multichain-stats.json"), JSON.stringify(rows, null, 2) + "\n");
for (const r of rows) {
  console.log(`  ${r.chain.padEnd(9)} makers ${String(r.makers).padStart(3)}  material books ${String(r.materialBooks).padStart(3)}  under-backed ${String(r.underBackedBooks).padStart(3)}  worst: ${r.worst ? `${r.worst.symbol} ~$${r.worst.usd.toLocaleString()} at ${r.worst.ratioPct}%` : "none"}`);
}
