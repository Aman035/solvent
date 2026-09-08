import { formatUnits, parseUnits, type Hex } from "viem";
import {
  readClient, role, addrs, program, buildOrder, orderHash, encodeStrategy,
  tx, ensureApproval, strategyBalances, ERC20_ABI, AQUA_ABI, explorerAddr,
} from "@aqua-solvent/core";

/**
 * Alice - the maker agent.
 *
 *   pnpm alice status   what she has promised vs what she actually holds
 *   pnpm alice ship     approve Aqua and ship a strategy (tokens never leave her wallet)
 *   pnpm alice betray   DEMO ONLY: move the committed inventory out, so the next fill
 *                       against her strategy reverts - a public broken promise
 *   pnpm alice restore  put the inventory back
 */

const rd = readClient();
const A = addrs();
const alice = role("alice");
const BURN = "0x000000000000000000000000000000000000dEaD" as Hex;
const cmd = process.argv[2] ?? "status";

const prog = program().gate(A.score, 0).xyc().fee(30_000);
const order = await buildOrder({ maker: alice.address, tokenA: A.usdc, tokenB: A.weth, program: prog.encode() });
const sh = await orderHash(order);

async function status() {
  const bal = await strategyBalances(alice.address, sh, A.usdc, A.weth);
  const wW = await rd.readContract({ address: A.weth, abi: ERC20_ABI, functionName: "balanceOf", args: [alice.address] }) as bigint;
  const wU = await rd.readContract({ address: A.usdc, abi: ERC20_ABI, functionName: "balanceOf", args: [alice.address] }) as bigint;

  console.log(`\n  ALICE  ${alice.address}`);
  console.log(`  strategy ${sh}`);
  console.log(`  program  [${prog.describe().join("][")}]\n`);
  if (!bal) { console.log(`  ✗ no active strategy — run: pnpm alice ship\n`); return null; }

  console.log(`  ${"".padEnd(10)}${"PROMISED (Aqua)".padEnd(22)}HELD (wallet)`);
  console.log(`  ${"WETH".padEnd(10)}${formatUnits(bal.token1, 18).padEnd(22)}${formatUnits(wW, 18)}`);
  console.log(`  ${"USDC".padEnd(10)}${formatUnits(bal.token0, 6).padEnd(22)}${formatUnits(wU, 6)}`);
  const backed = wW >= bal.token1;
  console.log(`\n  ${backed ? "✅ fully backed — every promise is deliverable" : `⚠️  PHANTOM LIQUIDITY — short ${formatUnits(bal.token1 - wW, 18)} WETH`}`);
  console.log(`  ${explorerAddr(alice.address)}\n`);
  return bal;
}

if (cmd === "status") {
  await status();

} else if (cmd === "ship") {
  const bal = await strategyBalances(alice.address, sh, A.usdc, A.weth);
  if (bal && (bal.token0 > 0n || bal.token1 > 0n)) { console.log(`\n  = already shipped\n`); await status(); }
  else {
    await tx(alice, "mint 20 WETH", { address: A.weth, abi: ERC20_ABI, functionName: "mint", args: [alice.address, parseUnits("20", 18)] });
    await tx(alice, "mint 40k USDC", { address: A.usdc, abi: ERC20_ABI, functionName: "mint", args: [alice.address, parseUnits("40000", 6)] });
    await ensureApproval(alice, A.weth, A.aqua, "approve Aqua (WETH)");
    await ensureApproval(alice, A.usdc, A.aqua, "approve Aqua (USDC)");
    await tx(alice, "aqua.ship", {
      address: A.aqua, abi: AQUA_ABI, functionName: "ship",
      args: [A.router, encodeStrategy(order), [A.usdc, A.weth], [parseUnits("20000", 6), parseUnits("10", 18)]],
    });
    await status();
  }

} else if (cmd === "betray") {
  /*
   * The whole thesis in one command.
   *
   * Aqua never took custody: Alice's committed WETH sat in her own wallet the entire
   * time. So she can simply move it. Her Aqua ledger entry still advertises the same
   * liquidity, but the next taker who tries to fill it gets a revert - a public,
   * permanent record that she promised something she could not deliver.
   */
  const before = await status();
  if (!before) process.exit(1);
  const wW = await rd.readContract({ address: A.weth, abi: ERC20_ABI, functionName: "balanceOf", args: [alice.address] }) as bigint;
  if (wW === 0n) { console.log(`  = already betrayed (wallet WETH is 0)\n`); process.exit(0); }

  console.log(`  ⚠️  BETRAYING — moving ${formatUnits(wW, 18)} WETH out of Alice's wallet`);
  console.log(`     her Aqua strategy still advertises ${formatUnits(before.token1, 18)} WETH\n`);
  await tx(alice, "transfer WETH away", { address: A.weth, abi: ERC20_ABI, functionName: "transfer", args: [BURN, wW] });
  await status();

} else if (cmd === "restore") {
  await tx(alice, "mint 20 WETH", { address: A.weth, abi: ERC20_ABI, functionName: "mint", args: [alice.address, parseUnits("20", 18)] });
  await status();

} else {
  console.log(`unknown command: ${cmd}  (status | ship | betray | restore)`);
  process.exit(1);
}
