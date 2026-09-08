import { formatEther } from "viem";
import { publicClient, allWallets, targetFor, activeChain, explorerAddr } from "@solvent/core";

const pc = publicClient();
const rows = allWallets();
console.log(`\n  chain: ${activeChain.key} (${activeChain.chainId})   block: ${await pc.getBlockNumber()}\n`);
console.log(`  ${"idx".padEnd(4)}${"role".padEnd(12)}${"address".padEnd(44)}${"balance".padStart(12)}  status`);

let underfunded = 0;
for (const { label, index, account } of rows) {
  const bal = await pc.getBalance({ address: account.address });
  const eth = Number(formatEther(bal));
  const target = targetFor(label.startsWith("sybil") ? "sybil" : label);
  const ok = eth >= target;
  if (!ok) underfunded++;
  console.log(
    `  ${String(index).padEnd(4)}${label.padEnd(12)}${account.address.padEnd(44)}` +
    `${eth.toFixed(5).padStart(12)}  ${ok ? "✅" : `❌ need ${target}`}`
  );
}
console.log(`\n  ${underfunded === 0 ? "✅ all wallets provisioned" : `⚠️  ${underfunded} underfunded - run: pnpm fund`}`);
console.log(`  deployer: ${explorerAddr(rows[0].account.address)}\n`);
