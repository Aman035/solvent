import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatEther } from "viem";
import {
  readClient, publicClient, walletClient, role, activeChain, explorerAddr,
  writeEntry, readManifest, REPO_ROOT, nextNonce,
} from "@aqua-solvent/core";

const ERC8004_COMMIT = "2e5e79d";  // ChaosChain/trustless-agents-erc-ri v1.2.0, CC0

function artifact(name: string) {
  const j = JSON.parse(readFileSync(resolve(REPO_ROOT, "contracts/erc8004-artifacts", `${name}.json`), "utf8"));
  return { abi: j.abi, bytecode: j.bytecode as `0x${string}` };
}

const rd = readClient();
const pc = publicClient();
const deployer = role("deployer");
const wc = walletClient(deployer);

console.log(`\n═══ ERC-8004 REGISTRIES → ${activeChain.key} ═══`);
console.log(`  reference impl: ChaosChain/trustless-agents-erc-ri @ ${ERC8004_COMMIT} (CC0)`);
console.log(`  V5 finding    : no ERC-8004 registry exists on Base Sepolia, so we deploy\n`);

async function deploy(label: string, name: string, args: unknown[]) {
  const existing = readManifest().contracts[label];
  if (existing) {
    const code = await rd.getBytecode({ address: existing.address as `0x${string}` });
    if (code && code.length > 2) { console.log(`  = ${label.padEnd(20)} ${existing.address}  (already deployed)`); return existing.address as `0x${string}`; }
  }
  const { abi, bytecode } = artifact(name);
  const nonce = await nextNonce(pc, deployer.address);
  const hash = await wc.deployContract({ abi, bytecode, args: args as never, nonce });
  const rc = await pc.waitForTransactionReceipt({ hash });
  if (rc.status !== "success" || !rc.contractAddress) throw new Error(`${label} failed`);
  writeEntry(label, { address: rc.contractAddress, deployBlock: Number(rc.blockNumber), txHash: hash, sourceCommit: ERC8004_COMMIT });
  console.log(`  + ${label.padEnd(20)} ${rc.contractAddress}  block ${rc.blockNumber}  gas ${rc.gasUsed}`);
  return rc.contractAddress;
}

const identity = await deploy("identityRegistry", "IdentityRegistry", []);
const reputation = await deploy("reputationRegistry", "ReputationRegistry", [identity]);
const validation = await deploy("validationRegistry", "ValidationRegistry", [identity]);

// sanity probes
const idAbi = [
  { name: "name", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { name: "symbol", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { name: "totalAgents", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;
const linkAbi = [{ name: "getIdentityRegistry", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }] as const;

console.log(`\n  probes:`);
console.log(`    identity.name()        = ${await rd.readContract({ address: identity, abi: idAbi, functionName: "name" })}`);
console.log(`    identity.symbol()      = ${await rd.readContract({ address: identity, abi: idAbi, functionName: "symbol" })}`);
console.log(`    identity.totalAgents() = ${await rd.readContract({ address: identity, abi: idAbi, functionName: "totalAgents" })}`);
for (const [n, a] of [["reputation", reputation], ["validation", validation]] as const) {
  const linked = await rd.readContract({ address: a, abi: linkAbi, functionName: "getIdentityRegistry" });
  console.log(`    ${n}.getIdentityRegistry() = ${linked}  ${String(linked).toLowerCase() === identity.toLowerCase() ? "✅ linked" : "❌ MISLINKED"}`);
}
console.log(`\n  remaining: ${formatEther(await rd.getBalance({ address: deployer.address }))} ETH`);
console.log(`  ${explorerAddr(identity)}\n`);
