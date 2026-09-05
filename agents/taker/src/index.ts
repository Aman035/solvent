import { formatUnits, parseUnits, decodeErrorResult, parseAbi, type Hex } from "viem";
import {
  readClient, role, addrs, candidates, subgraphHead, program, buildOrder, buildTakerData,
  orderHash, tx, ensureApproval, strategyBalances, ERC20_ABI, SWAP_ABI, explorerTx, env,
} from "@pof/core";
import { assess, selectCounterparty, type Assessment } from "./analyst.js";
import { narrate, llmConfig } from "./llm.js";

const rd = readClient();
const A = addrs();
const bob = role("bob");
const GATE_ERR = parseAbi(["error TakerBelowReputationFloor(address taker, uint32 score, uint32 floor)"]);

const amountArg = Number(process.argv[2] ?? 500);
const DRY = process.argv.includes("--dry");

const names: Record<string, string> = {
  [role("alice").address.toLowerCase()]: "Alice",
  [role("mallory").address.toLowerCase()]: "Mallory",
  [role("bob").address.toLowerCase()]: "Bob",
};
const nm = (a: string) => names[a.toLowerCase()] ?? `${a.slice(0, 10)}…`;

console.log(`\n╔══════════════════════════════════════════════════════════════════════╗`);
console.log(`║  BOB — autonomous taker                                              ║`);
console.log(`╚══════════════════════════════════════════════════════════════════════╝`);

// ── 1. live data ────────────────────────────────────────────────────────
const head = await subgraphHead();
const chain = Number(await rd.getBlockNumber());
console.log(`\n▸ querying The Graph`);
console.log(`  ${env.SUBGRAPH_URL}`);
console.log(`  subgraph @ ${head.block} · chain @ ${chain} · lag ${chain - head.block} blocks${head.hasIndexingErrors ? " ⚠️" : " ✅"}`);

const rows = (await candidates()).filter((r) => r.reviewCount > 0 || r.honoredCount > 0);
console.log(`  ${rows.length} candidate makers\n`);

// ── 2. analysis over the claimed/delivered join ─────────────────────────
console.log(`▸ analysing counterparties`);
console.log(`  ${"agent".padEnd(10)}${"reviews".padEnd(16)}${"delivered".padEnd(24)}${"score".padEnd(8)}verdict`);
console.log(`  ${"-".repeat(66)}`);
const assessments: Assessment[] = [];
for (const r of rows) {
  const a = await assess(r);
  assessments.push(a);
  const stars = r.reviewAvgBps / 10000;
  console.log(
    `  ${nm(r.id).padEnd(10)}` +
    `${(r.reviewCount ? `★${stars.toFixed(2)} (${r.reviewCount})` : "—").padEnd(16)}` +
    `${`$${a.honoredUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })} · ${r.honoredCount}✓ ${r.failedCount}✗`.padEnd(24)}` +
    `${String(a.score).padEnd(8)}${a.verdict.toUpperCase()}`,
  );
  for (const f of a.flags) console.log(`  ${" ".repeat(10)}⚑ ${f.code} (${f.severity}) — ${f.detail}`);
}

// ── 3. decision (deterministic rail) ────────────────────────────────────
const { chosen } = selectCounterparty(assessments);
console.log(`\n▸ decision`);
if (!chosen) { console.log(`  ✗ no counterparty has a delivery record — standing down.\n`); process.exit(0); }

const cfg = llmConfig();
const prose = await narrate(assessments, chosen);
console.log(`  reasoning ${prose ? `(${cfg!.provider}/${cfg!.model})` : "(deterministic — no LLM configured)"}:`);
for (const l of (prose ?? assessments.map((a) => `${nm(a.agent)}: ${a.rationale}`).join(" ")).split("\n")) {
  console.log(`    ${l}`);
}
console.log(`\n  → CHOSE ${nm(chosen.agent)} (score ${chosen.score})`);

// ── 4. execute ──────────────────────────────────────────────────────────
const prog = program().gate(A.score, 0).xyc().fee(30_000);
const order = await buildOrder({ maker: chosen.agent, tokenA: A.usdc, tokenB: A.weth, program: prog.encode() });
const sh = await orderHash(order);
const bal = await strategyBalances(chosen.agent, sh, A.usdc, A.weth);
if (!bal) { console.log(`\n  ✗ ${nm(chosen.agent)} has no active strategy at ${sh}\n`); process.exit(1); }

const amt = parseUnits(String(amountArg), 6);
const td = await buildTakerData({ taker: bob.address, isAToB: true });
console.log(`\n▸ executing ${amountArg} pofUSDC → pofWETH`);
try {
  const q = await rd.readContract({ address: A.router, abi: SWAP_ABI, functionName: "quote", args: [order, amt, td] as never, account: bob.address }) as readonly [bigint, bigint, Hex];
  console.log(`  quote  ${formatUnits(q[0], 6)} USDC → ${formatUnits(q[1], 18)} WETH`);
  if (DRY) { console.log(`  (dry run — not executing)\n`); process.exit(0); }

  const b = await rd.readContract({ address: A.usdc, abi: ERC20_ABI, functionName: "balanceOf", args: [bob.address] }) as bigint;
  if (b < amt) await tx(bob, "bob mint USDC", { address: A.usdc, abi: ERC20_ABI, functionName: "mint", args: [bob.address, amt - b] }, true);
  await ensureApproval(bob, A.usdc, A.router, "bob approve");
  const rc = await tx(bob, "bob swap", { address: A.router, abi: SWAP_ABI, functionName: "swap", args: [order, amt, td] });
  console.log(`  ✅ FILLED — ${explorerTx(rc.transactionHash)}\n`);
} catch (e: any) {
  let data: string | undefined;
  for (let c: any = e; c && !data; c = c.cause) if (typeof c.data === "string" && c.data.startsWith("0x")) data = c.data;
  let msg = String(e.shortMessage ?? e.message).slice(0, 120);
  if (data && data.length > 10) {
    try {
      const d = decodeErrorResult({ abi: GATE_ERR, data: data as Hex });
      const [t, s, f] = d.args as unknown as [Hex, number, number];
      msg = `${d.errorName}(taker=${t}, score=${s}, floor=${f})`;
    } catch { /* keep raw */ }
  }
  console.log(`  ⛔ COUNTERPARTY FAILED TO DELIVER — ${msg}\n`);
}
