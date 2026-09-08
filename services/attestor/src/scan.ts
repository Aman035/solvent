import { readClient, activeChain, explorerAddr, addrs } from "@solvent/core";
import { scanForFailures, recordFailures } from "./failures.js";

const LOOKBACK = Number(process.argv[2] ?? 400);
const rd = readClient();
const head = await rd.getBlockNumber();
const from = head - BigInt(LOOKBACK);

console.log(`\n═══ ATTESTOR — FAILURE SCAN ═══`);
console.log(`  chain    ${activeChain.key}`);
console.log(`  recorder ${explorerAddr(addrs().recorder)}`);
console.log(`  scanning blocks ${from}..${head} (${LOOKBACK}) for reverted swaps\n`);

const failures = await scanForFailures(from, head);
console.log(`  found ${failures.length} reverted swap${failures.length === 1 ? "" : "s"}\n`);
const n = await recordFailures(failures);
console.log(`\n  ✅ ${n} newly recorded on-chain\n`);
