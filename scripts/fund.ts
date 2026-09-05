import { parseEther, formatEther } from "viem";
import {
  publicClient, walletClient, role, allWallets, targetFor,
  activeChain, explorerAddr, SYBIL_START,
} from "@pof/core";

const pc = publicClient();
const deployer = role("deployer");
const wc = walletClient(deployer);

console.log(`\n  funding on ${activeChain.key} from ${deployer.address}\n`);

const bal = await pc.getBalance({ address: deployer.address });
console.log(`  deployer balance: ${formatEther(bal)} ETH`);

const wallets = allWallets().filter((w) => w.label !== "deployer");
const needed: { label: string; to: `0x${string}`; wei: bigint }[] = [];

for (const w of wallets) {
  const target = targetFor(w.label);
  const have = await pc.getBalance({ address: w.account.address });
  const want = parseEther(String(target));
  if (have < want) needed.push({ label: w.label, to: w.account.address, wei: want - have });
}

if (needed.length === 0) {
  console.log("\n  ✅ nothing to do - all wallets already provisioned\n");
  process.exit(0);
}

const total = needed.reduce((a, b) => a + b.wei, 0n);
console.log(`  ${needed.length} wallets need topping up, total ${formatEther(total)} ETH\n`);
if (bal < total) { console.error(`  ❌ deployer has ${formatEther(bal)}, needs ${formatEther(total)}`); process.exit(1); }

// Sequential nonces, fired without awaiting receipts, so the 20 Sybil burners land
// in as tight a block range as possible - that funding pattern is the evidence the
// dashboard surfaces ("all 20 funded by 0x… in block N").
let nonce = await pc.getTransactionCount({ address: deployer.address });
const sent: { label: string; hash: `0x${string}` }[] = [];

for (const n of needed) {
  const hash = await wc.sendTransaction({ to: n.to, value: n.wei, nonce: nonce++ });
  sent.push({ label: n.label, hash });
  process.stdout.write(`  → ${n.label.padEnd(11)} ${formatEther(n.wei).padStart(8)} ETH  ${hash.slice(0, 12)}…\n`);
}

console.log(`\n  waiting for ${sent.length} receipts…`);
const receipts = await Promise.all(sent.map((s) => pc.waitForTransactionReceipt({ hash: s.hash })));

const sybilBlocks = receipts
  .filter((_, i) => sent[i].label.startsWith("sybil"))
  .map((r) => Number(r.blockNumber));

if (sybilBlocks.length) {
  const lo = Math.min(...sybilBlocks), hi = Math.max(...sybilBlocks);
  console.log(`\n  sybil funding: ${sybilBlocks.length} wallets, blocks ${lo}${hi !== lo ? `–${hi}` : ""} (span ${hi - lo + 1})`);
  console.log(`  funder: ${explorerAddr(deployer.address)}`);
}

const failed = receipts.filter((r) => r.status !== "success").length;
console.log(`\n  ${failed === 0 ? "✅ all transfers confirmed" : `❌ ${failed} failed`}\n`);
process.exit(failed === 0 ? 0 : 1);
