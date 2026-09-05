import { formatUnits, parseUnits, decodeEventLog, parseAbi, type Hex } from "viem";
import {
  readClient, role, extraTaker, addrs, program, buildOrder, buildTakerData,
  encodeStrategy, orderHash, tx, ensureApproval, ERC20_ABI, AQUA_ABI, SWAP_ABI, strategyBalances,
} from "@pof/core";

const pc = readClient();
const A = addrs();
const alice = role("alice");
const bob = role("bob");
const poor = role("poorTaker");

const SCORE_ABI = [{ name: "scoreOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint32" }] }] as const;
const scoreOf = async (a: Hex) => await pc.readContract({ address: A.score, abi: SCORE_ABI, functionName: "scoreOf", args: [a] }) as number;

console.log(`\n═══ REPUTATION GATE — live on Base Sepolia ═══\n`);
console.log(`  current scores:`);
for (const [n, a] of [["alice", alice], ["bob", bob], ["poorTaker", poor]] as const) {
  console.log(`    ${n.padEnd(10)} ${a.address}  score=${await scoreOf(a.address)}`);
}

/*
 * IMPORTANT DESIGN POINT.
 *
 * ReputationGate scores the TAKER (ctx.query.taker == msg.sender). A pure taker never
 * honours anything, so it can never earn a score - which would make any non-zero floor
 * refuse everyone. That is not a bug in the gate; it reflects how the agent economy
 * actually works: agents are both makers and takers. So Bob first earns a record AS A
 * MAKER, and only then can he clear another maker's gate.
 */
console.log(`\n  [1] Bob earns a delivery record as a MAKER`);
const bobProg = program().gate(A.score, 0).xyc().fee(30_000);
const bobOrder = await buildOrder({ maker: bob.address, tokenA: A.usdc, tokenB: A.weth, program: bobProg.encode() });
const bobHash = await orderHash(bobOrder);
const bobBal = await strategyBalances(bob.address, bobHash, A.usdc, A.weth);

if (bobBal === null || (bobBal.token0 === 0n && bobBal.token1 === 0n)) {
  await tx(bob, "bob mint 6 WETH", { address: A.weth, abi: ERC20_ABI, functionName: "mint", args: [bob.address, parseUnits("6", 18)] });
  await tx(bob, "bob mint 12k USDC", { address: A.usdc, abi: ERC20_ABI, functionName: "mint", args: [bob.address, parseUnits("12000", 6)] });
  await ensureApproval(bob, A.weth, A.aqua, "bob approve Aqua (WETH)");
  await ensureApproval(bob, A.usdc, A.aqua, "bob approve Aqua (USDC)");
  await tx(bob, "bob aqua.ship", {
    address: A.aqua, abi: AQUA_ABI, functionName: "ship",
    args: [A.router, encodeStrategy(bobOrder), [A.usdc, A.weth], [parseUnits("12000", 6), parseUnits("6", 18)]],
  });
} else {
  console.log(`    = bob already shipped (${formatUnits(bobBal.token0, 6)} USDC / ${formatUnits(bobBal.token1, 18)} WETH)`);
}

const sizes = [900, 1700, 600, 1300];
console.log(`\n  [2] ${sizes.length} distinct takers fill BOB, giving him a record`);
for (let i = 0; i < sizes.length; i++) {
  const t = extraTaker(i);
  const amt = parseUnits(String(sizes[i]), 6);
  const bal = await pc.readContract({ address: A.usdc, abi: ERC20_ABI, functionName: "balanceOf", args: [t.address] }) as bigint;
  if (bal < amt) await tx(t, `taker[${i}] mint`, { address: A.usdc, abi: ERC20_ABI, functionName: "mint", args: [t.address, amt - bal] }, true);
  await ensureApproval(t, A.usdc, A.router, `taker[${i}] approve`);
  const td = await buildTakerData({ taker: t.address, isAToB: true });
  await tx(t, `taker[${i}] fills bob ${sizes[i]} USDC`, { address: A.router, abi: SWAP_ABI, functionName: "swap", args: [bobOrder, amt, td] });
}
console.log(`\n  ⏳ run \`pnpm attest\` so Bob's score reaches the chain, then re-run this script.`);
console.log(`     bob score now: ${await scoreOf(bob.address)}`);
