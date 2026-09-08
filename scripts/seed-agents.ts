import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { decodeEventLog, parseAbi, type Hex } from "viem";
import {
  readClient, role, allSybils, addrs, readManifest, tx, REPO_ROOT, explorerAddr, writeEntry,
} from "@solvent/core";

const rd = readClient();
const m = readManifest().contracts;
const IDENTITY = m.identityRegistry.address as Hex;
const REPUTATION = m.reputationRegistry.address as Hex;

const idAbi = JSON.parse(readFileSync(resolve(REPO_ROOT, "contracts/erc8004-artifacts/IdentityRegistry.json"), "utf8")).abi;
const repAbi = JSON.parse(readFileSync(resolve(REPO_ROOT, "contracts/erc8004-artifacts/ReputationRegistry.json"), "utf8")).abi;

/** ERC-8004 registration document, inlined as a data: URI so it needs no hosting. */
function agentURI(name: string, desc: string, wallet: string) {
  const doc = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name, description: desc,
    agentWallet: wallet,
    service: [{ type: "AquaMarketMaker", endpoint: "https://proof-of-fill.example/agent" }],
  };
  return `data:application/json;base64,${Buffer.from(JSON.stringify(doc)).toString("base64")}`;
}

async function ensureRegistered(who: ReturnType<typeof role>, label: string, desc: string): Promise<bigint> {
  const key = `agentId.${label}`;
  const existing = readManifest().contracts[key];
  if (existing) { console.log(`  = ${label.padEnd(9)} agentId ${BigInt(existing.note ?? "0")} (already registered)`); return BigInt(existing.note ?? "0"); }

  const rc = await tx(who, `register ${label}`, {
    address: IDENTITY, abi: idAbi, functionName: "register",
    args: [agentURI(label, desc, who.address)],
  });
  let agentId = 0n;
  for (const lg of rc.logs) {
    try {
      const d = decodeEventLog({ abi: parseAbi(["event Registered(uint256 indexed agentId, string agentURI, address indexed owner)"]), data: lg.data, topics: lg.topics }) as any;
      if (d.eventName === "Registered") agentId = d.args.agentId as bigint;
    } catch { /* not ours */ }
  }
  writeEntry(key, { address: who.address, deployBlock: Number(rc.blockNumber), txHash: rc.transactionHash, note: agentId.toString() });
  console.log(`      → agentId ${agentId}`);
  return agentId;
}

console.log(`\n═══ ERC-8004 AGENTS + SYBIL REVIEW SET ═══\n`);
console.log(`  identity   ${explorerAddr(IDENTITY)}`);
console.log(`  reputation ${explorerAddr(REPUTATION)}\n`);

const aliceId = await ensureRegistered(role("alice"), "alice", "Honest Aqua market maker");
const bobId = await ensureRegistered(role("bob"), "bob", "Agent that makes and takes");
const malloryId = await ensureRegistered(role("mallory"), "mallory", "Market maker with excellent reviews");

/*
 * THE POINT.
 *
 * giveFeedback() requires NO prior interaction, NO stake and NO registration by the
 * reviewer - condition C3 (groundedness) from arXiv 2606.26028, failing in practice.
 * Twenty burner wallets, funded from one address within a nine-block window, can hand
 * ANY agent a perfect score for the cost of gas.
 *
 * Both Alice and Mallory receive the SAME twenty reviews, so on the review axis they are
 * indistinguishable. Only the delivery record separates them. That is the entire pitch.
 */
const sybils = allSybils();
console.log(`\n  [reviews] ${sybils.length} burner wallets rate BOTH agents 5/5`);
console.log(`            (identical review profiles - only delivery will separate them)\n`);

const REVIEW_ABI = repAbi.filter((f: any) => f.name === "giveFeedback");
let posted = 0, skipped = 0;

for (const target of [{ id: aliceId, name: "alice" }, { id: malloryId, name: "mallory" }]) {
  const before = await rd.readContract({ address: REPUTATION, abi: repAbi, functionName: "getClients", args: [target.id] }) as readonly Hex[];
  if (before.length >= sybils.length) { console.log(`    = ${target.name} already has ${before.length} reviewers - skipping`); skipped++; continue; }

  for (let i = 0; i < sybils.length; i++) {
    await tx(sybils[i], `sybil[${i}] → ${target.name} 5/5`, {
      address: REPUTATION, abi: REVIEW_ABI, functionName: "giveFeedback",
      args: [target.id, 5n, 0, "quality", "", "", "", "0x0000000000000000000000000000000000000000000000000000000000000000"],
    }, true);
    posted++;
    if ((i + 1) % 5 === 0) console.log(`    ${target.name}: ${i + 1}/${sybils.length} reviews posted`);
  }
}

for (const t of [{ id: aliceId, name: "alice" }, { id: malloryId, name: "mallory" }]) {
  const clients = await rd.readContract({ address: REPUTATION, abi: repAbi, functionName: "getClients", args: [t.id] }) as readonly Hex[];
  console.log(`\n  ${t.name.padEnd(8)} agentId=${t.id}  reviewers=${clients.length}`);
}
console.log(`\n  ✅ ${posted} reviews posted${skipped ? `, ${skipped} agents already seeded` : ""}\n`);
