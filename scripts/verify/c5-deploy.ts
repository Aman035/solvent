import { publicClient, readManifest, activeChain, explorerAddr } from "@pof/core";

const pc = publicClient();
const m = readManifest();
let fail = 0;

console.log(`\n  C5 verification — ${activeChain.key} (${activeChain.chainId})\n`);
for (const [name, e] of Object.entries(m.contracts)) {
  const code = await pc.getBytecode({ address: e.address as `0x${string}` });
  const ok = !!code && code.length > 2;
  if (!ok) fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${name.padEnd(18)} ${e.address}  ${((code?.length ?? 2) - 2) / 2} bytes runtime`);
}

console.log("\n  functional probes:");
const score = m.contracts.proofOfFillScore.address as `0x${string}`;
const router = m.contracts.router.address as `0x${string}`;
const usdc = m.contracts.usdc.address as `0x${string}`;

const probes: [string, Promise<unknown>][] = [
  ["score.scoreOf(alice)", pc.readContract({ address: score, abi: [{ name: "scoreOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint32" }] }], functionName: "scoreOf", args: ["0xcCd3Ec4f9f4DeF07Ac4a99b28b253e2aec115882"] })],
  ["router.PROOF_OF_FILL_OPCODE_COUNT", pc.readContract({ address: router, abi: [{ name: "PROOF_OF_FILL_OPCODE_COUNT", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }], functionName: "PROOF_OF_FILL_OPCODE_COUNT" })],
  ["router.AQUA", pc.readContract({ address: router, abi: [{ name: "AQUA", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }], functionName: "AQUA" })],
  ["usdc.decimals()", pc.readContract({ address: usdc, abi: [{ name: "decimals", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] }], functionName: "decimals" })],
  ["usdc.symbol()", pc.readContract({ address: usdc, abi: [{ name: "symbol", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] }], functionName: "symbol" })],
];
for (const [label, p] of probes) {
  try { console.log(`    ✅ ${label.padEnd(34)} = ${await p}`); }
  catch (err) { fail++; console.log(`    ❌ ${label.padEnd(34)} ${(err as Error).message.split("\n")[0]}`); }
}

console.log(`\n  ${fail === 0 ? "✅ C5 PASS" : `❌ C5 FAIL (${fail})`}   ${explorerAddr(router)}\n`);
process.exit(fail === 0 ? 0 : 1);
