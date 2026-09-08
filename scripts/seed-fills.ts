import { formatUnits, parseUnits, decodeEventLog, parseAbi, type Hex } from "viem";
import {
  readClient, role, extraTaker, program, addrs, buildOrder, buildTakerData,
  encodeStrategy, orderHash, tx, ensureApproval, ERC20_ABI, AQUA_ABI, SWAP_ABI,
} from "@solvent/core";

const pc = readClient();
const A = addrs();
const alice = role("alice");

console.log(`\n═══ SEED FILLS — building Alice a real counterparty history ═══\n`);

// Alice's live strategy: gate at floor 0 (open), XYC curve, 0.3% fee.
const prog = program().gate(A.score, 0).xyc().fee(30_000);
const order = await buildOrder({ maker: alice.address, tokenA: A.usdc, tokenB: A.weth, program: prog.encode() });
const sh = await orderHash(order);
console.log(`  strategy ${sh}`);
console.log(`  program  [${prog.describe().join("][")}]\n`);

// Ensure it is shipped and stocked.
const [bU, bW] = await pc.readContract({
  address: A.aqua, abi: AQUA_ABI, functionName: "safeBalances",
  args: [alice.address, A.router, sh, A.usdc, A.weth],
}) as readonly [bigint, bigint];
console.log(`  aqua balances: ${formatUnits(bU, 6)} USDC / ${formatUnits(bW, 18)} WETH`);

if (bW < parseUnits("2", 18)) {
  console.log(`  restocking Alice…`);
  await tx(alice, "mint 20 pofWETH", { address: A.weth, abi: ERC20_ABI, functionName: "mint", args: [alice.address, parseUnits("20", 18)] });
  await tx(alice, "mint 40k pofUSDC", { address: A.usdc, abi: ERC20_ABI, functionName: "mint", args: [alice.address, parseUnits("40000", 6)] });
  await ensureApproval(alice, A.weth, A.aqua, "approve Aqua (WETH)");
  await ensureApproval(alice, A.usdc, A.aqua, "approve Aqua (USDC)");
  if (bU === 0n && bW === 0n) {
    await tx(alice, "aqua.ship", {
      address: A.aqua, abi: AQUA_ABI, functionName: "ship",
      args: [A.router, encodeStrategy(order), [A.usdc, A.weth], [parseUnits("20000", 6), parseUnits("10", 18)]],
    });
  }
}

// Five DISTINCT takers with deliberately uneven sizes, so the Herfindahl term has
// something real to measure. Equal sizes would flatter the diversity number.
const sizes = [1200, 3400, 800, 2100, 1500];

// PHASE 1 - provision every taker first, then fill. Interleaving mint-then-swap makes
// each swap depend on a read-after-write that a lagging RPC can miss, which showed up
// as a spurious SafeTransferFromFailed (the taker "could not pay" tokens it had).
console.log(`\n  [phase 1] provisioning ${sizes.length} takers`);
for (let i = 0; i < sizes.length; i++) {
  const t = extraTaker(i);
  const need = parseUnits(String(sizes[i]), 6);
  const bal = await pc.readContract({ address: A.usdc, abi: ERC20_ABI, functionName: "balanceOf", args: [t.address] }) as bigint;
  if (bal < need) {
    await tx(t, `taker[${i}] mint ${sizes[i]} USDC`, { address: A.usdc, abi: ERC20_ABI, functionName: "mint", args: [t.address, need - bal] }, true);
  }
  await ensureApproval(t, A.usdc, A.router, `taker[${i}] approve`);
}

console.log(`\n  [phase 2] fills — verifying funding before each swap\n`);
const SWAPPED = parseAbi(["event Swapped(bytes32 orderHash, address maker, address taker, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut)"]);

for (let i = 0; i < sizes.length; i++) {
  const t = extraTaker(i);
  const amount = parseUnits(String(sizes[i]), 6);

  const bal = await pc.readContract({ address: A.usdc, abi: ERC20_ABI, functionName: "balanceOf", args: [t.address] }) as bigint;
  if (bal < amount) { console.log(`    ⏭  taker[${i}] underfunded (${formatUnits(bal,6)} < ${sizes[i]}) - skipping`); continue; }

  const td = await buildTakerData({ taker: t.address, isAToB: true });
  const rc = await tx(t, `taker[${i}] fill ${sizes[i]} USDC`, {
    address: A.router, abi: SWAP_ABI, functionName: "swap", args: [order, amount, td],
  });

  let out = 0n;
  for (const lg of rc.logs) {
    try {
      const d = decodeEventLog({ abi: SWAPPED, data: lg.data, topics: lg.topics }) as any;
      if (d.eventName === "Swapped") out = d.args.amountOut as bigint;
    } catch { /* not Swapped */ }
  }
  console.log(`       delivered ${formatUnits(out, 18)} pofWETH`);
}
console.log(`\n  ✅ seeding complete — Alice now has multiple distinct counterparties\n`);
