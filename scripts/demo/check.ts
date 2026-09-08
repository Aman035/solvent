import { formatEther } from "viem";
import {
  readClient, publicClient, role, allWallets, targetFor, addrs, readManifest,
  subgraphHead, gql, activeChain, env,
} from "@solvent/core";

/**
 * Pre-flight. Run this immediately before hitting record.
 *
 * Everything here has ended a demo at least once: a lagging index, a drained wallet,
 * a maker who cannot deliver, a dashboard that is not running.
 */
const rd = readClient();
const problems: string[] = [];
const warn = (s: string) => problems.push(s);
const ok = (label: string, detail: string) => console.log(`  ✅ ${label.padEnd(26)} ${detail}`);
const bad = (label: string, detail: string) => { console.log(`  ❌ ${label.padEnd(26)} ${detail}`); warn(`${label}: ${detail}`); };

console.log(`\n═══ DEMO PRE-FLIGHT — ${activeChain.key} ═══\n`);

// 1. RPC
try {
  const b = await rd.getBlockNumber();
  ok("RPC", `block ${b.toLocaleString()}`);
} catch (e) { bad("RPC", (e as Error).message.slice(0, 60)); }

// 2. subgraph freshness — the single most common demo killer
try {
  const head = await subgraphHead();
  const chain = Number(await rd.getBlockNumber());
  const lag = chain - head.block;
  if (head.hasIndexingErrors) bad("Subgraph", "INDEXING ERRORS");
  else if (lag > 50) bad("Subgraph", `${lag} blocks behind (gate is 50) — wait before recording`);
  else ok("Subgraph", `${lag} blocks behind · ${env.SUBGRAPH_URL?.split("/").pop()}`);
} catch (e) { bad("Subgraph", (e as Error).message.slice(0, 60)); }

// 3. the cast must be on stage
try {
  const d = await gql<{ agents: any[]; global: any }>(
    `{ agents(where:{reviewCount_gte:20}){ id honoredCount reviewCount settlementScore }
       global(id:"global"){ totalHonored totalFailed } }`);
  const withDelivery = d.agents.filter((a) => a.honoredCount > 0).length;
  const without = d.agents.filter((a) => a.honoredCount === 0).length;
  if (d.agents.length < 2) bad("Cast", `${d.agents.length} reviewed agents, need 2`);
  else if (withDelivery === 0 || without === 0) bad("Cast", "need one agent WITH delivery and one WITHOUT");
  else ok("Cast", `${withDelivery} delivering vs ${without} not — the contrast holds`);
  if ((d.global?.totalFailed ?? 0) === 0) bad("Broken promise", "no FAILED fill indexed — run: pnpm alice betray");
  else ok("Broken promise", `${d.global.totalFailed} returned fill(s) on record`);
} catch (e) { bad("Cast", (e as Error).message.slice(0, 60)); }

// 4. Alice must be able to deliver, or scenario 1 fails on camera
try {
  const A = addrs();
  const alice = role("alice");
  const w = await rd.readContract({
    address: A.weth, abi: [{ name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }] as const,
    functionName: "balanceOf", args: [alice.address],
  }) as bigint;
  if (w === 0n) bad("Alice inventory", "wallet holds 0 WETH — run: pnpm alice restore");
  else ok("Alice inventory", `${formatEther(w)} pofWETH held`);
} catch (e) { bad("Alice inventory", (e as Error).message.slice(0, 60)); }

// 5. gas
let low = 0;
for (const w of allWallets()) {
  const b = await rd.getBalance({ address: w.account.address });
  if (Number(formatEther(b)) < targetFor(w.label) * 0.5) low++;
}
if (low > 0) bad("Wallets", `${low} below operating floor — run: pnpm fund`);
else ok("Wallets", `all ${allWallets().length} funded`);

// 6. dashboard
try {
  const r = await fetch("http://localhost:4173", { signal: AbortSignal.timeout(3000) });
  ok("Dashboard", r.ok ? "serving on :4173" : `HTTP ${r.status}`);
} catch { bad("Dashboard", "not running — run: pnpm dash:preview"); }

// 7. contracts
const m = readManifest().contracts;
const missing = ["aqua", "router", "settlementScore", "recorder", "identityRegistry"].filter((k) => !m[k]);
if (missing.length) bad("Contracts", `missing ${missing.join(", ")}`);
else ok("Contracts", `${Object.keys(m).filter((k) => !k.startsWith("agentId.")).length} deployed`);

console.log(`\n  ${problems.length === 0 ? "✅ CLEAR TO RECORD" : `❌ ${problems.length} problem(s) — do NOT record yet`}\n`);
process.exit(problems.length === 0 ? 0 : 1);
