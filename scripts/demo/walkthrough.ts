/**
 * The end-to-end demo: one maker wallet, three self-defending books, driven on-chain
 * in acts while the dashboard reacts live.
 *
 *   pnpm demo          paused before each act; in act 2 you take the quote yourself
 *                      from the Quote desk with your own wallet
 *   pnpm demo --fast   no pauses; the script takes the quote as the demo taker
 *
 * Keep the dashboard open beside the terminal: each act names the tab to watch.
 * Every transaction is real, and the last act resets everything so it can re-run.
 */
import { createInterface } from "node:readline/promises";
import { execSync } from "node:child_process";
import { formatUnits, parseUnits, decodeErrorResult, parseAbi, type Hex } from "viem";
import {
  readClient, account, role, addrs, program, buildOrder, buildTakerData, encodeStrategy,
  orderHash, tx, ensureApproval, gql, ERC20_ABI, AQUA_ABI, SWAP_ABI, REPO_ROOT, type Order,
} from "@aqua-solvent/core";
import { attestBooks } from "../../services/attestor/src/books.js";

const fast = process.argv.includes("--fast");
const pc = readClient();
const A = addrs();
const maker = account(37);
const bob = role("bob");
const FLOOR_ERR = parseAbi(["error MakerBeyondSolvencyFloor(address maker, address token, uint32 utilisationBps, uint32 maxUtilisationBps)"]);
const G = "\x1b[38;5;35m", R = "\x1b[38;5;167m", D = "\x1b[2m", X = "\x1b[0m", B = "\x1b[1m";

function act(n: number, title: string, screen: string) {
  console.log(`\n${G}${"═".repeat(74)}${X}`);
  console.log(`${G}  ACT ${n}${X}  ${B}${title}${X}`);
  console.log(`${D}  on screen: ${screen}${X}`);
  console.log(`${G}${"═".repeat(74)}${X}\n`);
}
async function pause(msg: string) {
  if (fast) return;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await rl.question(`\n  ⏸  ${msg}\n     [Enter] when ready… `);
  rl.close();
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** The CI keeper signs as the same attestor; on a nonce race, just try again. */
async function withNonceRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) {
      if (!/nonce/i.test(String((e as Error).message)) || i >= 3) throw e;
      console.log(`  ${D}nonce race with the CI keeper, retrying ${label}…${X}`);
      await sleep(4000);
    }
  }
}
async function sync(block: bigint) {
  process.stdout.write(`  ${D}indexing block ${block}${X}`);
  for (let i = 0; i < 60; i++) {
    const d = await gql<{ _meta: { block: { number: number } } }>(`{ _meta { block { number } } }`);
    if (BigInt(d._meta.block.number) >= block) break;
    process.stdout.write("."); await sleep(3000);
  }
  console.log(" ✓");
  await withNonceRetry(() => attestBooks(), "attest");
}
const BOOK_ABI = [{ name: "bookOf", type: "function", stateMutability: "view",
  inputs: [{ type: "address" }, { type: "address" }],
  outputs: [{ type: "tuple", components: [
    { type: "uint128", name: "committed" }, { type: "uint128", name: "backing" }, { type: "uint64", name: "updatedAt" }] }] }] as const;
async function bookLine() {
  const b = await pc.readContract({ address: A.solventBook, abi: BOOK_ABI, functionName: "bookOf", args: [maker.address, A.weth] }) as { committed: bigint; backing: bigint };
  const wallet = await pc.readContract({ address: A.weth, abi: ERC20_ABI, functionName: "balanceOf", args: [maker.address] }) as bigint;
  const u = b.backing === 0n ? Infinity : Number((b.committed * 10_000n) / b.backing) / 100;
  console.log(`  ${B}wallet ${formatUnits(wallet, 18).slice(0, 7)} WETH${X} · promised ${formatUnits(b.committed, 18).slice(0, 6)} · ${u.toFixed(1)}% utilised`);
  return b;
}
async function quoteAll(orders: Map<string, Order>) {
  for (const [k, order] of orders) {
    const td = await buildTakerData({ taker: bob.address, isAToB: true });
    try {
      const q = await pc.readContract({ address: A.router, abi: SWAP_ABI, functionName: "quote",
        args: [order, parseUnits("10", 6), td] as never, account: bob.address }) as readonly [bigint, bigint, Hex];
      const px = 10 / Number(formatUnits(q[1], 18));
      console.log(`    strategy ${k}   bid ${G}${px.toFixed(2)}${X} USDC/WETH`);
    } catch (e) {
      let data: string | undefined;
      for (let c = e as { data?: string; cause?: unknown } | undefined; c && !data; c = c.cause as never)
        if (typeof c.data === "string" && c.data.startsWith("0x")) data = c.data;
      let msg = "reverted";
      if (data) try {
        const d = decodeErrorResult({ abi: FLOOR_ERR, data: data as Hex });
        msg = `${R}DECLINED${X} · SolvencyFloor · ${(Number(d.args![2]) / 100).toFixed(1)}% > ${(Number(d.args![3]) / 100).toFixed(0)}%`;
      } catch { /* raw */ }
      console.log(`    strategy ${k}   ${msg}`);
    }
  }
}

console.log(`\n${B}SOLVENT · the end-to-end demo${X}`);
console.log(`${D}dashboard: https://aman035.github.io/solvent/  (Testnet)${X}`);

// ── ACT 1: a maker makes promises ────────────────────────────────────────────
act(1, "A maker ships three strategies against one wallet", "Balance sheets tab");
const prev = await gql<{ strategies: { id: Hex }[] }>(
  `{ strategies(where: { maker: "${maker.address.toLowerCase()}", active: true }, first: 20) { id } }`);
for (const s of prev.strategies)
  await tx(maker, `dock old ${s.id.slice(0, 10)}`, { address: A.aqua, abi: AQUA_ABI, functionName: "dock", args: [A.router, s.id, [A.usdc, A.weth]] }, true);
async function setBal(token: Hex, target: bigint, label: string) {
  const have = await pc.readContract({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [maker.address] }) as bigint;
  if (have < target) await tx(maker, `top up ${label}`, { address: token, abi: ERC20_ABI, functionName: "mint", args: [maker.address, target - have] }, true);
  if (have > target) await tx(maker, `trim ${label}`, { address: token, abi: ERC20_ABI, functionName: "transfer", args: [role("deployer").address, have - target] }, true);
}
await setBal(A.weth, parseUnits("10", 18), "WETH");
await setBal(A.usdc, parseUnits("15000", 6), "USDC");
await ensureApproval(maker, A.weth, A.aqua, "approve");
await ensureApproval(maker, A.usdc, A.aqua, "approve");
const SALT = Math.floor(Date.now() / 60_000) % 97;
const orders = new Map<string, Order>();
let rc;
for (const [k, fee, start] of [["A", 30_000, 5_000], ["B", 30_000, 4_750], ["C", 32_000, 5_000]] as const) {
  const p = program().solvencyFloor(A.solventBook, 9_500).solvencySkew(A.solventBook, start, 400_000).xyc().fee(fee + SALT);
  const order = await buildOrder({ maker: maker.address, tokenA: A.usdc, tokenB: A.weth, program: p.encode() });
  orders.set(k, order);
  rc = await tx(maker, `ship strategy ${k} · promises 1.5 WETH`, {
    address: A.aqua, abi: AQUA_ABI, functionName: "ship",
    args: [A.router, encodeStrategy(order), [A.usdc, A.weth], [parseUnits("4650", 6), parseUnits("1.5", 18)]],
  });
}
await sync(rc!.blockNumber);
await bookLine();
console.log(`\n  ${D}the promises are virtual: 4.5 WETH promised, all 10 still in the wallet${X}`);
await quoteAll(orders);
await pause("Balance sheets: the maker's row just appeared at 45%. Point at the green capsule.");

// ── ACT 2: a taker fills ─────────────────────────────────────────────────────
act(2, "A real taker fills a quote", "Quote desk, then Settlement ledger");
if (fast) {
  const amt = parseUnits("500", 6);
  const bal = await pc.readContract({ address: A.usdc, abi: ERC20_ABI, functionName: "balanceOf", args: [bob.address] }) as bigint;
  if (bal < amt) await tx(bob, "mint", { address: A.usdc, abi: ERC20_ABI, functionName: "mint", args: [bob.address, amt - bal] }, true);
  await ensureApproval(bob, A.usdc, A.router, "approve");
  const td = await buildTakerData({ taker: bob.address, isAToB: true });
  const r2 = await tx(bob, "taker fills strategy A · 500 USDC", { address: A.router, abi: SWAP_ABI, functionName: "swap", args: [orders.get("A")!, amt, td] });
  await sync(r2.blockNumber);
} else {
  await pause("YOUR TURN: on the Quote desk, connect your wallet and Take this quote (500 USDC). Press Enter AFTER it confirms.");
  const head = await pc.getBlockNumber();
  await sync(head);
}
await bookLine();
console.log(`  ${D}WETH left the maker's wallet at settlement, straight to the taker${X}`);
await pause("Settlement ledger: the fill is in the feed (yours is tagged 'you'). Delivered value went up.");

// ── ACT 3: the wallet drains, the books notice ───────────────────────────────
act(3, "The maker redeploys inventory elsewhere. Aqua would not notice.", "Quote desk (watch the bids), Balance sheets (watch the capsule)");
const b3 = await pc.readContract({ address: A.solventBook, abi: BOOK_ABI, functionName: "bookOf", args: [maker.address, A.weth] }) as { committed: bigint };
const target87 = (b3.committed * 10_000n) / 8_700n;
const w3 = await pc.readContract({ address: A.weth, abi: ERC20_ABI, functionName: "balanceOf", args: [maker.address] }) as bigint;
console.log("  before:"); await quoteAll(orders);
const r3 = await tx(maker, "maker sweeps WETH out (to ~87% utilised)", { address: A.weth, abi: ERC20_ABI, functionName: "transfer", args: [role("deployer").address, w3 - target87] });
await sync(r3.blockNumber);
await bookLine();
console.log("  after, no keeper, no human:"); await quoteAll(orders);
await pause("The same books now quote wider. The oracle repriced them automatically.");

// ── ACT 4: past the floor ────────────────────────────────────────────────────
act(4, "The maker keeps going, past the 95% floor", "Quote desk scene 3, Balance sheets 'past floor'");
const target99 = (b3.committed * 10_000n) / 9_900n;
const w4 = await pc.readContract({ address: A.weth, abi: ERC20_ABI, functionName: "balanceOf", args: [maker.address] }) as bigint;
const r4 = await tx(maker, "maker sweeps past the floor (99%)", { address: A.weth, abi: ERC20_ABI, functionName: "transfer", args: [role("deployer").address, w4 - target99] });
await sync(r4.blockNumber);
await bookLine();
await quoteAll(orders);
console.log(`\n  ${D}refused at quote time, with a reason: no taker wastes gas on an empty wallet${X}`);
await pause("This is the whole product in one screen: widen, then refuse.");

// ── ACT 5: what happens WITHOUT solvent ──────────────────────────────────────
act(5, "The contrast: an unprotected maker breaks a promise", "Settlement ledger (watch RETURNED)");
const run = (cmd: string) => execSync(cmd, { cwd: REPO_ROOT, stdio: "inherit" });
run("pnpm exec tsx scripts/maker.ts betray");
run("pnpm exec tsx scripts/betray-flow.ts");
for (let i = 0; ; i++) {
  try { run("pnpm exec tsx services/attestor/src/scan.ts 300"); break; }
  catch (e) { if (i >= 2) throw e; console.log(`  ${D}retrying the failure scan…${X}`); await sleep(4000); }
}
await pause("Alice's book had no floor. The taker paid gas, the fill reverted, and the ledger keeps the scar forever.");

// ── restore ──────────────────────────────────────────────────────────────────
act(6, "Reset for the next take", "any tab");
await setBal(A.weth, (b3.committed * 10_000n) / 4_500n, "WETH restore");
const head = await pc.getBlockNumber();
await sync(head);
run("pnpm demo:reset");
await bookLine();
console.log(`\n${G}${B}  Done. Every number on screen is on-chain, indexed, and repeatable.${X}\n`);
