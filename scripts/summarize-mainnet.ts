/** Distill docs/mainnet-history.json into headline stats and an SVG chart. */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { REPO_ROOT } from "@pof/core";

const H = JSON.parse(readFileSync(resolve(REPO_ROOT, "docs/mainnet-history.json"), "utf8"));
type Obs = { block: string; maker: string; token: string; symbol: string; committed: string; backing: string; ratioBps: number; committedUsd: number | null };
const obs: Obs[] = H.observations;

const MATERIAL = 100;                       // USD floor for headline claims
const mat = obs.filter((o) => (o.committedUsd ?? 0) >= MATERIAL);
const matUnder = mat.filter((o) => o.ratioBps < 10_000);
const key = (o: Obs) => `${o.maker}|${o.token}`;
const booksMat = new Set(mat.map(key));
const booksUnder = new Set(matUnder.map(key));
const makersUnder = new Set(matUnder.map((o) => o.maker));

// per-snapshot aggregate (priced tokens only): committed vs covered
const byBlock = new Map<string, { committed: number; covered: number }>();
for (const o of obs) {
  if (o.committedUsd === null) continue;
  const dec = H.tokens[o.token.toLowerCase()]?.decimals ?? 18;
  const price = o.committedUsd / (Number(o.committed) / 10 ** dec || 1);
  const backingUsd = (Number(o.backing) / 10 ** dec) * price;
  const covered = Math.min(o.committedUsd, backingUsd);
  const b = byBlock.get(o.block) ?? { committed: 0, covered: 0 };
  b.committed += o.committedUsd; b.covered += covered;
  byBlock.set(o.block, b);
}
const snaps = [...byBlock.entries()]
  .map(([block, v]) => ({ block: Number(block), ...v }))
  .sort((a, b) => a.block - b.block)
  // peak-moment reads share blocks with few books; keep the ~1.5-day grid only
  .filter((s) => (s.block - Number(H.deployBlock)) % 65000 === 0 || s.block === Number(H.head));

// persistence of the worst case
const worstBook = [...booksUnder].map((k) => {
  const rows = matUnder.filter((o) => key(o) === k);
  const usd = Math.max(...rows.map((o) => o.committedUsd ?? 0));
  const minRatio = Math.min(...rows.map((o) => o.ratioBps));
  return { k, usd, minRatio, snapshots: new Set(rows.map((o) => o.block)).size, sym: rows[0].symbol, maker: rows[0].maker };
}).sort((a, b) => b.usd * (1 - b.minRatio / 10_000) - a.usd * (1 - a.minRatio / 10_000));

const stats = {
  generatedAt: new Date().toISOString(),
  window: { deployBlock: H.deployBlock, head: H.head, chain: "base" },
  events: H.eventCounts, makers: H.makers, coverage: `${H.shipCalldataDecoded}/${H.shipTotal}`,
  materialFloorUsd: MATERIAL,
  materialObservations: mat.length,
  materialUnderBacked: matUnder.length,
  pctUnderBacked: Math.round((matUnder.length / Math.max(1, mat.length)) * 100),
  booksMaterial: booksMat.size, booksUnderBacked: booksUnder.size,
  makersUnderBacked: makersUnder.size,
  worstBooks: worstBook.slice(0, 5),
  latest: snaps[snaps.length - 1],
};
writeFileSync(resolve(REPO_ROOT, "docs/mainnet-stats.json"), JSON.stringify(stats, null, 2) + "\n");
console.log(JSON.stringify(stats, null, 2).split("\n").slice(0, 30).join("\n"));

// ── SVG: advertised vs actually backed, across Aqua's whole life ───────────
const W = 960, Hh = 380, PL = 78, PR = 24, PT = 46, PB = 44;
const iw = W - PL - PR, ih = Hh - PT - PB;
const maxY = Math.max(...snaps.map((s) => s.committed)) * 1.08;
const x = (i: number) => PL + (i / (snaps.length - 1)) * iw;
const y = (v: number) => PT + ih - (v / maxY) * ih;
const pts = (f: (s: typeof snaps[number]) => number) => snaps.map((s, i) => `${x(i).toFixed(1)},${y(f(s)).toFixed(1)}`).join(" ");
const areaC = `${PL},${PT + ih} ${pts((s) => s.committed)} ${PL + iw},${PT + ih}`;
const areaB = `${PL},${PT + ih} ${pts((s) => s.covered)} ${PL + iw},${PT + ih}`;
const fmt = (v: number) => v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3)}k`;
const gridYs = [0.25, 0.5, 0.75, 1].map((f) => maxY * f);
const day0 = Number(H.deployBlock);
const days = (b: number) => Math.round((b - day0) * 2 / 86400);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${Hh}" font-family="ui-monospace,SFMono-Regular,Menlo,monospace">
  <rect width="${W}" height="${Hh}" fill="#14181c"/>
  <text x="${PL}" y="24" fill="#eef1f4" font-size="15" font-weight="600" font-family="ui-sans-serif,system-ui">Aqua on Base mainnet: liquidity advertised vs actually backed</text>
  <text x="${PL}" y="40" fill="#6c7681" font-size="11">every maker book, reconstructed on-chain from launch to block ${Number(H.head).toLocaleString("en-US")} · priced majors only · indicative USD</text>
  ${gridYs.map((v) => `<line x1="${PL}" x2="${PL + iw}" y1="${y(v)}" y2="${y(v)}" stroke="#2f363e" stroke-width="1"/><text x="${PL - 8}" y="${y(v) + 4}" fill="#6c7681" font-size="10" text-anchor="end">${fmt(v)}</text>`).join("\n  ")}
  <polygon points="${areaC}" fill="#f0626b" fill-opacity="0.16"/>
  <polygon points="${areaB}" fill="#3fd39b" fill-opacity="0.28"/>
  <polyline points="${pts((s) => s.committed)}" fill="none" stroke="#f0626b" stroke-width="2"/>
  <polyline points="${pts((s) => s.covered)}" fill="none" stroke="#3fd39b" stroke-width="2"/>
  ${snaps.map((s, i) => i % 4 === 0 && i < snaps.length - 2 ? `<text x="${x(i)}" y="${Hh - 16}" fill="#6c7681" font-size="10" text-anchor="middle">day ${days(s.block)}</text>` : "").join("")}
  <text x="${x(Math.floor(snaps.length * 0.62))}" y="${y(maxY * 0.38)}" fill="#f0626b" font-size="12" text-anchor="middle" opacity="0.9">this gap is phantom liquidity:</text>
  <text x="${x(Math.floor(snaps.length * 0.62))}" y="${y(maxY * 0.38) + 16}" fill="#f0626b" font-size="12" text-anchor="middle" opacity="0.9">advertised, quoting, undeliverable</text>
  <g font-size="11.5">
    <rect x="${W - 320}" y="${PT + 6}" width="10" height="10" fill="#f0626b" fill-opacity="0.7"/>
    <text x="${W - 304}" y="${PT + 15}" fill="#a7b0ba">advertised by makers (committed)</text>
    <rect x="${W - 320}" y="${PT + 24}" width="10" height="10" fill="#3fd39b" fill-opacity="0.8"/>
    <text x="${W - 304}" y="${PT + 33}" fill="#a7b0ba">actually deliverable (backed)</text>
  </g>
</svg>`;
writeFileSync(resolve(REPO_ROOT, "docs/graphics/phantom-liquidity.svg"), svg + "\n");
console.log(`\n  → docs/graphics/phantom-liquidity.svg (${snaps.length} points)`);
