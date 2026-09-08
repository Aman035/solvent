/**
 * Full balance-sheet reconstruction for every real Aqua maker on Base mainnet,
 * at EVENT resolution, from primary data only:
 *
 *   committed(strategy, token):  initialised from the ship() transaction calldata
 *                                (tokens[] and amounts[] are right there),
 *                                then Pushed adds, Pulled subtracts, Docked zeroes.
 *   backing(maker, token):       balanceOf + allowance(maker -> Aqua), read from an
 *                                archive node at sampled heights AND at each book's
 *                                peak-commitment block, where under-backing is most
 *                                likely to show.
 *
 * No layout guessing, no sampling of events. Output: docs/mainnet-history.json
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, http, parseAbi, decodeFunctionData, formatUnits, type Hex } from "viem";
import { base, arbitrum, optimism } from "viem/chains";
import { REPO_ROOT } from "@solvent/core";

const AQUA = "0x1111113ccf1426a8e30e2bff5e005d929bf6a90a" as Hex;   // same on every chain (CREATE3)

const CHAINS = {
  base: {
    chain: base, scanRpc: "https://mainnet.base.org",
    archive: ["https://base.drpc.org", "https://base.llamarpc.com", "https://base-mainnet.public.blastapi.io", "https://base.meowrpc.com", "https://1rpc.io/base"],
    step: 65_000n,          // ~1.5 days at 2s blocks
  },
  arbitrum: {
    chain: arbitrum, scanRpc: "https://arb1.arbitrum.io/rpc",
    archive: ["https://arbitrum.drpc.org", "https://arb1.arbitrum.io/rpc", "https://arbitrum-one.public.blastapi.io", "https://1rpc.io/arb"],
    step: 500_000n,         // ~1.45 days at 0.25s blocks
  },
  optimism: {
    chain: optimism, scanRpc: "https://mainnet.optimism.io",
    archive: ["https://optimism.drpc.org", "https://optimism.llamarpc.com", "https://optimism-mainnet.public.blastapi.io", "https://1rpc.io/op"],
    step: 65_000n,
  },
} as const;
type ChainKey = keyof typeof CHAINS;
const KEY = (process.argv[2] ?? "base") as ChainKey;
const CFG = CHAINS[KEY];
if (!CFG) { console.error(`unknown chain ${KEY}`); process.exit(2); }
console.log(`═══ chain: ${KEY} ═══`);
const scan = createPublicClient({ chain: CFG.chain, transport: http(CFG.scanRpc, { timeout: 30_000, retryCount: 3 }) });

/**
 * Historical state needs an archive node. Free archive endpoints rate-limit hard, so
 * rotate across several with global pacing and per-call failover.
 */
const archives = CFG.archive.map((u) => createPublicClient({ chain: CFG.chain, transport: http(u, { timeout: 25_000, retryCount: 0 }) }));
let rr = 0; let lastCall = 0;
async function archived<T>(fn: (c: typeof archives[number]) => Promise<T>): Promise<T> {
  const wait = 120 - (Date.now() - lastCall);        // ~8 req/s globally
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  let err: unknown;
  for (let i = 0; i < archives.length; i++) {
    const c = archives[(rr + i) % archives.length];
    try { const out = await fn(c); rr = (rr + i) % archives.length; return out; }
    catch (e) { err = e; }
  }
  throw err;
}
const state = { readContract: (args: any) => archived((c) => c.readContract(args)) } as any;
void state;

const EVENTS = parseAbi([
  "event Shipped(address maker, address app, bytes32 strategyHash, bytes strategy)",
  "event Docked(address maker, address app, bytes32 strategyHash)",
  "event Pulled(address maker, address app, bytes32 strategyHash, address token, uint256 amount)",
  "event Pushed(address maker, address app, bytes32 strategyHash, address token, uint256 amount)",
]);
const SHIP_ABI = parseAbi([
  "function ship(address app, bytes strategy, address[] tokens, uint256[] amounts) returns (bytes32)",
]);
const ERC20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address, address) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

// ── 1. full event log (cached) ────────────────────────────────────────────
interface Ev { name: string; block: string; logIndex: number; tx: Hex; args: Record<string, string> }
const CACHE = resolve(REPO_ROOT, KEY === "base" ? "docs/mainnet-events.json" : `docs/mainnet-events.${KEY}.json`);
let events: Ev[]; let deployBlock: bigint; let head: bigint;

if (existsSync(CACHE)) {
  const j = JSON.parse(readFileSync(CACHE, "utf8"));
  events = j.events; deployBlock = BigInt(j.deployBlock); head = BigInt(j.head);
  console.log(`  cache: ${events.length} events`);
} else {
  head = await scan.getBlockNumber();
  let lo = 0n, hi = head;
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    // must run on archive nodes; an RPC failure here must throw, never read as "no code"
    const code = await archived((c) => c.getBytecode({ address: AQUA, blockNumber: mid }));
    if (code && code.length > 2) hi = mid; else lo = mid + 1n;
  }
  deployBlock = lo;
  events = [];
  // adaptive ranges: try wide, halve on provider errors, floor at 9k
  let chunk = 200_000n;
  let from = deployBlock;
  while (from <= head) {
    const to = from + chunk > head ? head : from + chunk;
    try {
      const logs = await scan.getLogs({ address: AQUA, events: EVENTS, fromBlock: from, toBlock: to });
      for (const lg of logs) {
        const args: Record<string, string> = {};
        for (const [k, v] of Object.entries(lg.args as object)) args[k] = String(v);
        events.push({ name: lg.eventName!, block: lg.blockNumber!.toString(), logIndex: lg.logIndex!, tx: lg.transactionHash!, args });
      }
      from = to + 1n;
      if (chunk < 200_000n) chunk *= 2n;
    } catch {
      if (chunk > 9_000n) { chunk /= 2n; continue; }
      await new Promise((r) => setTimeout(r, 1500));
    }
    if ((from - deployBlock) % 1_000_000n < chunk) process.stdout.write(`\r  scanning ${(from - deployBlock).toLocaleString()} / ${(head - deployBlock).toLocaleString()} blocks…`);
  }
  writeFileSync(CACHE, JSON.stringify({ deployBlock: deployBlock.toString(), head: head.toString(), events }, null, 0) + "\n");
  console.log(`\r  scanned: ${events.length} events cached`);
}
events.sort((a, b) => Number(BigInt(a.block) - BigInt(b.block)) || a.logIndex - b.logIndex);
const counts: Record<string, number> = {};
for (const e of events) counts[e.name] = (counts[e.name] ?? 0) + 1;
console.log(`  ${JSON.stringify(counts)}  ·  blocks ${deployBlock.toLocaleString()} → ${head.toLocaleString()}`);

// ── 2. ship() calldata → exact tokens and initial amounts ─────────────────
const shipEvents = events.filter((e) => e.name === "Shipped");
const shipInit = new Map<string, { tokens: Hex[]; amounts: bigint[] }>();
let calldataFails = 0;
await pool(shipEvents, 6, async (e) => {
  try {
    const tx = await scan.getTransaction({ hash: e.tx });
    const d = decodeFunctionData({ abi: SHIP_ABI, data: tx.input });
    const [, , tokens, amounts] = d.args as [Hex, Hex, Hex[], bigint[]];
    shipInit.set(e.args.strategyHash, { tokens: tokens.map((t) => t.toLowerCase() as Hex), amounts: [...amounts] });
  } catch { calldataFails++; }
});
console.log(`  ship calldata decoded: ${shipInit.size}/${shipEvents.length} (${calldataFails} via wrappers)`);

// Wrapper-shipped strategies: recover tokens from their later Pulled/Pushed events and
// initial amounts from rawBalances at the ship block. rawBalances is a plain storage
// read and never reverts, so this is layout-agnostic.
const RAW_ABI = parseAbi([
  "function rawBalances(address maker, address app, bytes32 strategyHash, address token) view returns (uint248, uint8)",
]);
const tokensSeen = new Map<string, Set<string>>();
for (const e of events) {
  if (e.name === "Pulled" || e.name === "Pushed") {
    if (!tokensSeen.has(e.args.strategyHash)) tokensSeen.set(e.args.strategyHash, new Set());
    tokensSeen.get(e.args.strategyHash)!.add(e.args.token.toLowerCase());
  }
}
const wrapperShips = shipEvents.filter((e) => !shipInit.has(e.args.strategyHash) && tokensSeen.has(e.args.strategyHash));
let recovered = 0;
await pool(wrapperShips, 3, async (e) => {
  const hash = e.args.strategyHash;
  const toks = [...tokensSeen.get(hash)!];
  const amounts: bigint[] = [];
  try {
    for (const t of toks) {
      const [bal] = await state.readContract({
        address: AQUA, abi: RAW_ABI, functionName: "rawBalances",
        args: [e.args.maker as Hex, e.args.app as Hex, hash as Hex, t as Hex],
        blockNumber: BigInt(e.block),
      }) as readonly [bigint, number];
      amounts.push(bal);
    }
    shipInit.set(hash, { tokens: toks as Hex[], amounts });
    recovered++;
  } catch { /* leave uncovered, counted below */ }
});
console.log(`  wrapper books recovered via rawBalances: ${recovered}/${wrapperShips.length}  ·  total coverage ${shipInit.size}/${shipEvents.length}`);

// ── 3. replay: per-strategy-token virtual balances, event by event ─────────
const stratBal = new Map<string, bigint>();          // hash|token -> committed
const stratMaker = new Map<string, Hex>();           // hash -> maker
const bookOf = (m: string, t: string) => `${m.toLowerCase()}|${t.toLowerCase()}`;
const makerBook = new Map<string, bigint>();         // maker|token -> committed (aggregate)
const peak = new Map<string, { committed: bigint; block: string }>();

function bump(hash: string, token: string, delta: bigint, block: string) {
  const sk = `${hash}|${token.toLowerCase()}`;
  const maker = stratMaker.get(hash); if (!maker) return;
  const cur = stratBal.get(sk) ?? 0n;
  let next = cur + delta; if (next < 0n) next = 0n;
  stratBal.set(sk, next);
  const bk = bookOf(maker, token);
  const agg = (makerBook.get(bk) ?? 0n) + (next - cur);
  makerBook.set(bk, agg);
  const p = peak.get(bk);
  if (!p || agg > p.committed) peak.set(bk, { committed: agg, block });
}

const STEP = CFG.step;                               // ~1.5 days per chain
let nextSnap = deployBlock + STEP;
interface Snap { block: string; books: { maker: Hex; token: Hex; committed: string }[] }
const snaps: Snap[] = [];
function snapshot(block: string) {
  const books = [...makerBook.entries()].filter(([, v]) => v > 0n)
    .map(([k, v]) => { const [maker, token] = k.split("|") as [Hex, Hex]; return { maker, token, committed: v.toString() }; });
  snaps.push({ block, books });
}
for (const e of events) {
  while (BigInt(e.block) >= nextSnap) { snapshot(nextSnap.toString()); nextSnap += STEP; }
  const h = e.args.strategyHash;
  if (e.name === "Shipped") {
    stratMaker.set(h, e.args.maker as Hex);
    const init = shipInit.get(h);
    if (init) for (let i = 0; i < init.tokens.length; i++) bump(h, init.tokens[i], init.amounts[i], e.block);
  } else if (e.name === "Pushed") bump(h, e.args.token, BigInt(e.args.amount), e.block);
  else if (e.name === "Pulled") bump(h, e.args.token, -BigInt(e.args.amount), e.block);
  else if (e.name === "Docked") {
    for (const [sk, bal] of stratBal) {
      if (sk.startsWith(h + "|") && bal > 0n) bump(h, sk.split("|")[1], -bal, e.block);
    }
  }
}
snapshot(head.toString());
console.log(`  replayed → ${snaps.length} snapshots · ${peak.size} maker-token books ever committed`);

// ── 4. backing at snapshots + at each book's PEAK commitment ──────────────
const meta = new Map<string, { symbol: string; decimals: number }>();
async function tokenMeta(t: Hex) {
  const k = t.toLowerCase();
  if (!meta.has(k)) {
    const [sym, dec] = await Promise.all([
      state.readContract({ address: t, abi: ERC20, functionName: "symbol" }).catch(() => t.slice(0, 8)),
      state.readContract({ address: t, abi: ERC20, functionName: "decimals" }).catch(() => 18),
    ]);
    meta.set(k, { symbol: sym as string, decimals: Number(dec) });
  }
  return meta.get(k)!;
}
/** Indicative USD prices for majors, used ONLY as a materiality floor and clearly
 *  labelled indicative. Unknown tokens are still counted, just not USD-ranked. */
const USD: Record<string, number> = {
  "0x4200000000000000000000000000000000000006": 3000,   // WETH
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": 1,      // USDC
  "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2": 1,      // USDT
  "0x820c137fa70c8691f0e44dc420a5e53c168921dc": 1,      // USDS
  "0x50c5725949a6f0c72e6c4a641f24049a917db0cb": 1,      // DAI
  "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf": 110000, // cbBTC
  "0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22": 3300,   // cbETH
  "0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452": 3600,   // wstETH
};
function usdOf(token: string, amount: bigint, decimals: number): number | null {
  const p = USD[token.toLowerCase()];
  if (p === undefined) return null;
  return Number(formatUnits(amount, decimals)) * p;
}

async function backingAt(maker: Hex, token: Hex, block: bigint): Promise<bigint | null> {
  try {
    const [bal, alw] = await Promise.all([
      state.readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [maker], blockNumber: block }),
      state.readContract({ address: token, abi: ERC20, functionName: "allowance", args: [maker, AQUA], blockNumber: block }),
    ]) as [bigint, bigint];
    return bal < alw ? bal : alw;
  } catch { return null; }
}

interface Obs { block: string; maker: Hex; token: Hex; symbol: string; committed: string; backing: string; ratioBps: number; committedUsd: number | null }
const observations: Obs[] = [];
let stateFails = 0;

// snapshot heights
for (const s of snaps) {
  const res = await pool(s.books, 3, async (b) => {
    const m = await tokenMeta(b.token);
    const usd = usdOf(b.token, BigInt(b.committed), m.decimals);
    if (usd !== null && usd < 1) return null;                 // dust, skip the read
    const bk = await backingAt(b.maker, b.token, BigInt(s.block));
    if (bk === null) { stateFails++; return null; }
    const ratio = Number((bk * 10_000n) / BigInt(b.committed));
    return { block: s.block, maker: b.maker, token: b.token, symbol: m.symbol, committed: b.committed, backing: bk.toString(), ratioBps: ratio, committedUsd: usd } as Obs;
  });
  for (const r of res) if (r) observations.push(r);
}
// peak-commitment moments, where under-backing is most likely
const peaks = [...peak.entries()].filter(([, p]) => p.committed > 0n);
const peakObs = await pool(peaks, 3, async ([bk, p]) => {
  const [maker, token] = bk.split("|") as [Hex, Hex];
  const m = await tokenMeta(token);
  const usd = usdOf(token, p.committed, m.decimals);
  if (usd !== null && usd < 1) return null;
  const backing = await backingAt(maker, token, BigInt(p.block));
  if (backing === null) { stateFails++; return null; }
  return { block: p.block, maker, token, symbol: m.symbol, committed: p.committed.toString(), backing: backing.toString(), ratioBps: Number((backing * 10_000n) / p.committed), committedUsd: usd } as Obs;
});
for (const r of peakObs) if (r) observations.push(r);

// ── 5. report ──────────────────────────────────────────────────────────────
const makers = new Set([...peak.keys()].map((k) => k.split("|")[0]));
const under = observations.filter((o) => o.ratioBps < 10_000);
under.sort((a, b) => (b.committedUsd ?? 0) * (1 - b.ratioBps / 10_000) - (a.committedUsd ?? 0) * (1 - a.ratioBps / 10_000));
console.log(`\n  observations: ${observations.length} (state read failures: ${stateFails})`);
console.log(`  distinct makers ever committed: ${makers.size}`);
console.log(`  UNDER-BACKED observations (< 100%): ${under.length}`);
for (const o of under.slice(0, 12)) {
  const m = meta.get(o.token.toLowerCase())!;
  const f = (v: string) => Number(formatUnits(BigInt(v), m.decimals)).toLocaleString("en-US", { maximumFractionDigits: 4 });
  console.log(`   ‼ block ${o.block}  ${o.maker.slice(0, 12)}  ${o.symbol.padEnd(8)} committed ${f(o.committed).padStart(14)} (~$${(o.committedUsd ?? 0).toFixed(0).padStart(8)})  backing ${f(o.backing).padStart(14)}  ${(o.ratioBps / 100).toFixed(1)}%`);
}

writeFileSync(resolve(REPO_ROOT, KEY === "base" ? "docs/mainnet-history.json" : `docs/mainnet-history.${KEY}.json`), JSON.stringify({
  chain: KEY, aqua: AQUA, deployBlock: deployBlock.toString(), head: head.toString(),
  analyzedAt: new Date().toISOString(), eventCounts: counts,
  shipCalldataDecoded: shipInit.size, shipTotal: shipEvents.length,
  makers: makers.size, snapshots: snaps.length,
  tokens: Object.fromEntries(meta), observations, underBacked: under.length,
}, null, 1) + "\n");
console.log(`  → docs/mainnet-history${KEY === "base" ? "" : "." + KEY}.json`);
