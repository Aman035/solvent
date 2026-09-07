/**
 * S3 parity gate: the indexed books must survive independent recomputation.
 *
 * For each chain, take the largest maker books from the subgraph and rebuild each one
 * from primary sources at the book's own updatedAtBlock:
 *
 *   committed = sum of Aqua.rawBalances(maker, app, hash, token) over every strategy
 *               the index knows for that (maker, token), read from an archive node
 *   backing   = min(token.balanceOf(maker), token.allowance(maker, aqua)) at that block
 *
 * The subgraph maintains committed by folding per-touch diffs; this script sums the
 * live per-strategy balances directly. Agreement is demanded to the wei.
 */
import { createPublicClient, http, parseAbi } from "viem";
import { base, arbitrum, optimism } from "viem/chains";
import { computeUtilisationBps } from "@pof/core";

const AQUA = "0x1111113ccf1426a8e30e2bff5e005d929bf6a90a" as const;
const PER_CHAIN = 10;

const CHAINS = [
  { key: "base", chain: base, env: "SUBGRAPH_URL_BASE",
    archive: ["https://base.drpc.org", "https://base-mainnet.public.blastapi.io", "https://base.meowrpc.com", "https://1rpc.io/base"] },
  { key: "arbitrum", chain: arbitrum, env: "SUBGRAPH_URL_ARBITRUM",
    archive: ["https://arbitrum.drpc.org", "https://arbitrum-one.public.blastapi.io", "https://1rpc.io/arb"] },
  { key: "optimism", chain: optimism, env: "SUBGRAPH_URL_OPTIMISM",
    archive: ["https://optimism.drpc.org", "https://optimism-mainnet.public.blastapi.io", "https://optimism.llamarpc.com", "https://1rpc.io/op"] },
] as const;

const ABI = parseAbi([
  "function rawBalances(address maker, address app, bytes32 strategyHash, address token) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address, address) view returns (uint256)",
]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function gql(url: string, query: string): Promise<any> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query }) });
  const j = (await res.json()) as any;
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  return j.data;
}

let failures = 0;

for (const C of CHAINS) {
  const url = process.env[C.env];
  if (!url) throw new Error(`${C.env} not set`);
  const clients = C.archive.map((u) => createPublicClient({ chain: C.chain, transport: http(u, { timeout: 25_000, retryCount: 0 }) }));
  let rr = 0;
  const archived = async <T>(fn: (c: (typeof clients)[number]) => Promise<T>): Promise<T> => {
    let last: unknown;
    for (let i = 0; i < clients.length * 4; i++) {
      const c = clients[(rr + i) % clients.length];
      try { const out = await fn(c); rr = (rr + i) % clients.length; return out; }
      catch (e) { last = e; await sleep(400 * (1 + Math.floor(i / clients.length))); }
    }
    throw last;
  };

  const d = await gql(url, `{
    meta: _meta { block { number } }
    makerBooks(orderBy: committed, orderDirection: desc, first: ${PER_CHAIN}) {
      maker token committed backing utilisationBps updatedAtBlock
    }
  }`);
  console.log(`\n── ${C.key} (indexed to ${d.meta.block.number}) · checking ${d.makerBooks.length} largest books`);

  for (const b of d.makerBooks) {
    const blockNumber = BigInt(b.updatedAtBlock);
    // the strategy universe for this (maker, token), as the index learned it
    const st = await gql(url, `{
      strategyTokens(where: { maker: "${b.maker}", token: "${b.token}" }, first: 1000) { strategyHash }
      strategies(where: { maker: "${b.maker}" }, first: 1000) { id app }
    }`);
    const appOf = new Map<string, string>(st.strategies.map((s: any) => [s.id.toLowerCase(), s.app]));
    let committed = 0n;
    for (const t of st.strategyTokens) {
      const app = appOf.get(t.strategyHash.toLowerCase());
      if (!app) throw new Error(`no app for strategy ${t.strategyHash}`);
      committed += await archived((c) => c.readContract({
        address: AQUA, abi: ABI, functionName: "rawBalances",
        args: [b.maker, app as `0x${string}`, t.strategyHash, b.token], blockNumber,
      }));
      await sleep(150);
    }
    const bal = await archived((c) => c.readContract({ address: b.token, abi: ABI, functionName: "balanceOf", args: [b.maker], blockNumber }));
    await sleep(150);
    const alw = await archived((c) => c.readContract({ address: b.token, abi: ABI, functionName: "allowance", args: [b.maker, AQUA], blockNumber }));
    const backing = bal < alw ? bal : alw;
    const util = computeUtilisationBps(committed, backing);

    const okC = committed === BigInt(b.committed);
    const okB = backing === BigInt(b.backing);
    const okU = String(util) === b.utilisationBps;
    const ok = okC && okB && okU;
    if (!ok) failures++;
    console.log(`  ${ok ? "✓" : "✗"} ${b.maker.slice(0, 10)} ${b.token.slice(0, 10)} @${blockNumber}`
      + ` committed ${b.committed}${okC ? "" : ` != chain ${committed}`}`
      + ` backing ${b.backing}${okB ? "" : ` != chain ${backing}`}`
      + ` util ${b.utilisationBps}bps${okU ? "" : ` != ${util}`}`
      + ` [${st.strategyTokens.length} strategies]`);
  }
}

console.log(failures === 0
  ? `\nPARITY: every book matches independent recomputation to the wei`
  : `\nPARITY FAILED: ${failures} books disagree`);
if (failures > 0) process.exit(1);
