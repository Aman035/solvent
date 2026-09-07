/**
 * REAL on-chain analysis of the live Aqua deployment.
 *
 * Enumerates every strategy ever shipped on mainnet Aqua, decodes its token pair from
 * the strategy blob, reads each maker's CURRENT virtual commitments via safeBalances,
 * and compares the aggregate against what the wallet actually holds and has approved.
 *
 * No sampling, no simulation: every number comes from the chain at one block height.
 * Output: docs/mainnet-analysis.json (+ printed report).
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, http, parseAbi, formatUnits, type Hex } from "viem";
import { base } from "viem/chains";
import { REPO_ROOT } from "@pof/core";

const AQUA = "0x1111113ccf1426a8e30e2bff5e005d929bf6a90a" as Hex;
const RPC = process.env.BASE_MAINNET_RPC ?? "https://mainnet.base.org";
const CHUNK = 9_000n;

const pc = createPublicClient({ chain: base, transport: http(RPC, { timeout: 30_000, retryCount: 3 }) });

const EVENTS = parseAbi([
  "event Shipped(address maker, address app, bytes32 strategyHash, bytes strategy)",
  "event Docked(address maker, address app, bytes32 strategyHash)",
  "event Pulled(address maker, address app, bytes32 strategyHash, address token, uint256 amount)",
  "event Pushed(address maker, address app, bytes32 strategyHash, address token, uint256 amount)",
]);
const AQUA_ABI = parseAbi([
  "function safeBalances(address maker, address app, bytes32 strategyHash, address token0, address token1) view returns (uint256, uint256)",
]);
const ERC20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address, address) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

// ── find deployment block (binary search on code presence) ─────────────────
const head = await pc.getBlockNumber();
let lo = 0n, hi = head;
while (lo < hi) {
  const mid = (lo + hi) / 2n;
  const code = await pc.getBytecode({ address: AQUA, blockNumber: mid }).catch(() => undefined);
  if (code && code.length > 2) hi = mid; else lo = mid + 1n;
}
const deployBlock = lo;
console.log(`  Aqua deployed at block ${deployBlock.toLocaleString()} · head ${head.toLocaleString()} · scanning ${(head - deployBlock).toLocaleString()} blocks`);

// ── full event history, chunked ────────────────────────────────────────────
interface Strat { maker: Hex; app: Hex; hash: Hex; tokens: [Hex, Hex] | null; docked: boolean }
const strategies = new Map<string, Strat>();
const seenTokens = new Map<string, Set<Hex>>();          // strategyHash -> tokens seen in pulls/pushes
let nShip = 0, nDock = 0, nPull = 0, nPush = 0;

function decodeTokens(blob: Hex): [Hex, Hex] | null {
  // strategy = abi.encode(Order{maker,traits,data}); data = tokenA(20) ++ tokenB(20) ++ program
  const b = blob.slice(2);
  if (b.length < (160 + 40) * 2) return null;
  const len = parseInt(b.slice(156 * 2, 160 * 2), 16);
  if (len <= 40 || 160 + len > b.length / 2) return null;
  const a = ("0x" + b.slice(160 * 2, 180 * 2)) as Hex;
  const t = ("0x" + b.slice(180 * 2, 200 * 2)) as Hex;
  return [a, t];
}

let done = 0n;
for (let from = deployBlock; from <= head; from += CHUNK + 1n) {
  const to = from + CHUNK > head ? head : from + CHUNK;
  const logs = await pc.getLogs({ address: AQUA, events: EVENTS, fromBlock: from, toBlock: to })
    .catch(async () => { await new Promise((r) => setTimeout(r, 1500)); return pc.getLogs({ address: AQUA, events: EVENTS, fromBlock: from, toBlock: to }); });
  for (const lg of logs) {
    const a = lg.args as any;
    if (lg.eventName === "Shipped") {
      nShip++;
      strategies.set(a.strategyHash, { maker: a.maker, app: a.app, hash: a.strategyHash, tokens: decodeTokens(a.strategy), docked: false });
    } else if (lg.eventName === "Docked") {
      nDock++;
      const s = strategies.get(a.strategyHash); if (s) s.docked = true;
    } else {
      if (lg.eventName === "Pulled") nPull++; else nPush++;
      if (!seenTokens.has(a.strategyHash)) seenTokens.set(a.strategyHash, new Set());
      seenTokens.get(a.strategyHash)!.add((a.token as string).toLowerCase() as Hex);
    }
  }
  done += to - from + 1n;
  if (done % 200_000n < CHUNK) process.stdout.write(`\r  scanned ${done.toLocaleString()} blocks…`);
}
console.log(`\r  scanned ${(head - deployBlock).toLocaleString()} blocks — ships ${nShip} · docks ${nDock} · pulls ${nPull} · pushes ${nPush}`);

// backfill unknown token pairs from pull/push observations
for (const s of strategies.values()) {
  if (!s.tokens) {
    const seen = [...(seenTokens.get(s.hash) ?? [])];
    if (seen.length === 2) s.tokens = [seen[0], seen[1]];
  }
}
const active = [...strategies.values()].filter((s) => !s.docked);
const decodable = active.filter((s) => s.tokens);
console.log(`  strategies: ${strategies.size} shipped · ${active.length} active · ${decodable.length} with decodable token pair`);

// ── current commitments per (maker, token), read at ONE block height ───────
const AT = head;
type Book = Map<string, bigint>;               // "maker|token" -> committed
const committed: Book = new Map();
const key = (m: Hex, t: Hex) => `${m.toLowerCase()}|${t.toLowerCase()}`;

for (const s of decodable) {
  try {
    const [b0, b1] = await pc.readContract({
      address: AQUA, abi: AQUA_ABI, functionName: "safeBalances",
      args: [s.maker, s.app, s.hash, s.tokens![0], s.tokens![1]], blockNumber: AT,
    }) as readonly [bigint, bigint];
    committed.set(key(s.maker, s.tokens![0]), (committed.get(key(s.maker, s.tokens![0])) ?? 0n) + b0);
    committed.set(key(s.maker, s.tokens![1]), (committed.get(key(s.maker, s.tokens![1])) ?? 0n) + b1);
  } catch { /* docked or non-standard app */ }
}

// ── backing per (maker, token): min(balance, allowance) at the same height ─
const meta = new Map<string, { symbol: string; decimals: number }>();
async function tokenMeta(t: Hex) {
  const k = t.toLowerCase();
  if (!meta.has(k)) {
    const [sym, dec] = await Promise.all([
      pc.readContract({ address: t, abi: ERC20, functionName: "symbol" }).catch(() => t.slice(0, 8)),
      pc.readContract({ address: t, abi: ERC20, functionName: "decimals" }).catch(() => 18),
    ]);
    meta.set(k, { symbol: sym as string, decimals: dec as number });
  }
  return meta.get(k)!;
}

interface Row {
  maker: Hex; token: Hex; symbol: string; decimals: number;
  committed: string; balance: string; allowance: string; backing: string;
  ratioBps: number;                                        // backing / committed
}
const rows: Row[] = [];
for (const [k, comm] of committed) {
  if (comm === 0n) continue;
  const [maker, token] = k.split("|") as [Hex, Hex];
  const [bal, alw] = await Promise.all([
    pc.readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [maker], blockNumber: AT }).catch(() => 0n),
    pc.readContract({ address: token, abi: ERC20, functionName: "allowance", args: [maker, AQUA], blockNumber: AT }).catch(() => 0n),
  ]) as [bigint, bigint];
  const backing = bal < alw ? bal : alw;
  const m = await tokenMeta(token);
  rows.push({
    maker, token, symbol: m.symbol, decimals: m.decimals,
    committed: comm.toString(), balance: bal.toString(), allowance: alw.toString(), backing: backing.toString(),
    ratioBps: comm > 0n ? Number((backing * 10_000n) / comm) : 0,
  });
}
rows.sort((a, b) => a.ratioBps - b.ratioBps);

// ── report ─────────────────────────────────────────────────────────────────
const makers = new Set(rows.map((r) => r.maker));
const under = rows.filter((r) => r.ratioBps < 10_000);
const severely = rows.filter((r) => r.ratioBps < 5_000);
const zero = rows.filter((r) => r.ratioBps === 0);

console.log(`\n  ═══ BALANCE SHEETS AT BLOCK ${AT.toLocaleString()} ═══`);
console.log(`  ${makers.size} makers · ${rows.length} maker-token books\n`);
console.log(`  ${"maker".padEnd(14)}${"token".padEnd(9)}${"committed".padStart(16)}${"backing".padStart(16)}${"ratio".padStart(9)}`);
for (const r of rows) {
  const f = (v: string) => Number(formatUnits(BigInt(v), r.decimals)).toLocaleString("en-US", { maximumFractionDigits: 4 });
  const flag = r.ratioBps >= 10_000 ? " " : r.ratioBps >= 5_000 ? "!" : "‼";
  console.log(`${flag} ${r.maker.slice(0, 12).padEnd(14)}${r.symbol.slice(0, 8).padEnd(9)}${f(r.committed).padStart(16)}${f(r.backing).padStart(16)}${((r.ratioBps / 100).toFixed(1) + "%").padStart(9)}`);
}
console.log(`\n  under-backed books (ratio < 100%): ${under.length} of ${rows.length}  (${((under.length / Math.max(1, rows.length)) * 100).toFixed(0)}%)`);
console.log(`  severely under-backed (< 50%)    : ${severely.length}`);
console.log(`  fully phantom (0% backing)       : ${zero.length}`);

writeFileSync(resolve(REPO_ROOT, "docs/mainnet-analysis.json"), JSON.stringify({
  chain: "base", chainId: 8453, aqua: AQUA,
  analyzedAtBlock: AT.toString(), analyzedAt: new Date().toISOString(),
  deployBlock: deployBlock.toString(),
  events: { shipped: nShip, docked: nDock, pulled: nPull, pushed: nPush },
  strategies: { shipped: strategies.size, active: active.length, decodable: decodable.length },
  makers: makers.size, books: rows.length,
  underBacked: under.length, severelyUnderBacked: severely.length, fullyPhantom: zero.length,
  rows,
}, null, 2) + "\n");
console.log(`\n  → docs/mainnet-analysis.json\n`);
