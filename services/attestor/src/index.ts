import { formatUnits, type Hex } from "viem";
import {
  readClient, role, addrs, agentsWithHistory, subgraphHead, computeScore,
  diversityBpsFrom, tx, explorerAddr, activeChain, readManifest,
} from "@aqua-solvent/core";

/**
 * The attestor.
 *
 * Reads delivery history from the subgraph, derives each agent's settlement score,
 * and writes it to the on-chain cache the ReputationGate opcode reads. This is the step
 * that closes the loop: without it the gate has nothing to enforce.
 *
 * TRUST: in this prototype the attestor is a trusted updater. Every number it writes is
 * re-derivable from the same public subgraph by anyone, and each input is a transaction
 * hash - see docs/TRUST_ASSUMPTIONS.md.
 */

const SCORE_ABI = [
  { name: "setScoreBatch", type: "function", stateMutability: "nonpayable",
    inputs: [
      { type: "address[]", name: "accounts" },
      { type: "tuple[]", name: "ss", components: [
        { type: "uint128", name: "honoredValueUsd6" }, { type: "uint32", name: "honoredCount" },
        { type: "uint32", name: "failedCount" }, { type: "uint16", name: "diversityBps" },
        { type: "uint64", name: "updatedAt" },
      ] },
    ], outputs: [] },
  { name: "scoreOf", type: "function", stateMutability: "view",
    inputs: [{ type: "address" }], outputs: [{ type: "uint32" }] },
] as const;

const ONCE = process.argv.includes("--once");
const INTERVAL_MS = 20_000;

const pc = readClient();
const attestor = role("attestor");
const A = addrs();

function ts() { return new Date().toISOString().slice(11, 19); }
function line(sym: string, msg: string) { console.log(`  ${ts()} ${sym} ${msg}`); }

async function tick(): Promise<number> {
  const head = await subgraphHead();
  const chain = Number(await pc.getBlockNumber());
  const lag = chain - head.block;
  line("·", `subgraph @ ${head.block}  chain @ ${chain}  lag ${lag} blocks${head.hasIndexingErrors ? "  ⚠️ INDEXING ERRORS" : ""}`);
  if (lag > 50) line("⚠", `lag above the 50-block demo gate - scores may be stale`);

  const agents = await agentsWithHistory();
  if (agents.length === 0) { line("·", "no agents with delivery history yet"); return 0; }

  const accounts: Hex[] = [];
  const scores: any[] = [];

  for (const a of agents) {
    const values = (a.counterparties ?? []).map((c) => BigInt(c.valueUsd6));
    // Recompute diversity from raw counterparty values rather than trusting the
    // subgraph's cached field, so the on-chain number is independently derived.
    const diversityBps = diversityBpsFrom(values);
    const parts = {
      honoredValueUsd6: BigInt(a.honoredValueUsd6),
      honoredCount: a.honoredCount, failedCount: a.failedCount, diversityBps,
    };
    const derived = computeScore(parts);
    const onChain = await pc.readContract({ address: A.score, abi: SCORE_ABI, functionName: "scoreOf", args: [a.id] }) as number;

    if (BigInt(onChain) === derived) {
      line("=", `${a.id.slice(0, 10)} score ${derived} already current`);
      continue;
    }
    line("→", `${a.id.slice(0, 10)}  $${formatUnits(parts.honoredValueUsd6, 6)} honored · ${a.honoredCount}✓ ${a.failedCount}✗ · ${values.length} counterparties · diversity ${(diversityBps / 100).toFixed(2)}%  ⇒ score ${onChain} → ${derived}`);
    accounts.push(a.id);
    scores.push({ ...parts, diversityBps, updatedAt: 0n });
  }

  if (accounts.length === 0) { line("·", "all scores current"); return 0; }

  await tx(attestor, `setScoreBatch(${accounts.length})`, {
    address: A.score, abi: SCORE_ABI, functionName: "setScoreBatch", args: [accounts, scores],
  });

  for (let i = 0; i < accounts.length; i++) {
    const got = await pc.readContract({ address: A.score, abi: SCORE_ABI, functionName: "scoreOf", args: [accounts[i]] }) as number;
    const want = computeScore(scores[i]);
    line(BigInt(got) === want ? "✅" : "❌", `${accounts[i].slice(0, 10)} on-chain scoreOf = ${got}${BigInt(got) === want ? "" : ` (expected ${want})`}`);
  }
  return accounts.length;
}

console.log(`\n═══ SOLVENT — ATTESTOR ═══`);
console.log(`  chain    ${activeChain.key} (${activeChain.chainId})`);
console.log(`  score    ${explorerAddr(A.score)}`);
console.log(`  attestor ${attestor.address}`);
console.log(`  mode     ${ONCE ? "single pass" : `watching every ${INTERVAL_MS / 1000}s`}\n`);

if (ONCE) {
  await tick();
} else {
  for (;;) {
    try { await tick(); } catch (e) { line("❌", `${(e as Error).message}`); }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}
