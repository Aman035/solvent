/**
 * The README vignette, live: one wallet backs three books, and the books defend
 * themselves through the full production loop -
 *
 *   chain -> The Graph (maker books) -> attestor -> SolventBook -> quote()
 *
 * No keeper logic in this script: between steps it only waits for the indexer and
 * runs the same attestation the service runs. The quotes move on their own.
 *
 * Sequence: three floor+skew strategies quote side by side; a taker fill barely moves
 * them (fills are healthy); the maker then redeploys inventory out of the wallet -
 * the measured mainnet behavior - and the surviving books widen, then refuse.
 */
import { formatUnits, parseUnits, parseEther, decodeErrorResult, parseAbi, type Hex } from "viem";
import {
  readClient, publicClient, walletClient, role, account, addrs, program, buildOrder, buildTakerData,
  encodeStrategy, orderHash, tx, ensureApproval, strategyBalances, gql,
  ERC20_ABI, AQUA_ABI, SWAP_ABI, type Order,
} from "@pof/core";
import { attestBooks } from "../../services/attestor/src/books.js";

const pc = readClient();
const A = addrs();
const maker = account(37); // the vignette maker: one wallet, three books
const taker = account(38);
const FLOOR_BPS = 9_500;      // refuse above 95% utilisation
const SKEW_START = 5_000;     // widening begins at 50%
const SKEW_MAX = 400_000;     // up to 4.00% at full utilisation (1e7 denom)
const WETH_PER_BOOK = parseUnits("1.5", 18);
const USDC_PER_BOOK = parseUnits("4650", 6); // 3100 USDC/WETH mid
const TRADE_IN = parseUnits("500", 6);
const PROBE_IN = parseUnits("10", 6); // small probe so the bid reads as a price, not an impact

const FLOOR_ERR = parseAbi(["error MakerBeyondSolvencyFloor(address maker, address token, uint32 utilisationBps, uint32 maxUtilisationBps)"]);
const BOOK_ABI = [{ name: "bookOf", type: "function", stateMutability: "view",
  inputs: [{ type: "address" }, { type: "address" }],
  outputs: [{ type: "tuple", components: [
    { type: "uint128", name: "committed" }, { type: "uint128", name: "backing" }, { type: "uint64", name: "updatedAt" }] }] }] as const;

// A, B and C are separately tuned books (which also gives them distinct hashes).
// A docked hash can never ship again, so each session salts the fee by a few
// hundredths of a bp to mint fresh strategies.
const SALT = Math.floor(Date.now() / 60_000) % 97;
const BOOKS = [
  { key: "A", fee: 30_000 + SALT, skewStart: SKEW_START },
  { key: "B", fee: 30_000 + SALT, skewStart: SKEW_START - 250 },
  { key: "C", fee: 32_000 + SALT, skewStart: SKEW_START },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fundEthIfNeeded() {
  const deployer = role("deployer");
  const wc = walletClient(deployer);
  const p = publicClient();
  let nonce = await p.getTransactionCount({ address: deployer.address });
  for (const w of [maker, taker]) {
    const have = await p.getBalance({ address: w.address });
    if (have < parseEther("0.001")) {
      const h = await wc.sendTransaction({ to: w.address, value: parseEther("0.003"), nonce: nonce++ });
      await p.waitForTransactionReceipt({ hash: h });
      console.log(`  funded ${w.address.slice(0, 10)} with gas`);
    }
  }
}

/** Wait until the subgraph has indexed at least `block`, then attest books on-chain. */
async function syncBooks(block: bigint) {
  process.stdout.write(`      … The Graph indexing to block ${block}`);
  for (let i = 0; i < 60; i++) {
    const d = await gql<{ _meta: { block: { number: number } } }>(`{ _meta { block { number } } }`);
    if (BigInt(d._meta.block.number) >= block) break;
    await sleep(3_000);
    process.stdout.write(".");
  }
  console.log(" indexed");
  await attestBooks();
}

async function bookLine(): Promise<{ utilisationBps: number }> {
  const b = await pc.readContract({
    address: A.solventBook, abi: BOOK_ABI, functionName: "bookOf", args: [maker.address, A.weth],
  }) as { committed: bigint; backing: bigint };
  const wallet = await pc.readContract({ address: A.weth, abi: ERC20_ABI, functionName: "balanceOf", args: [maker.address] }) as bigint;
  const u = b.backing === 0n ? 0xffffffff : Number((b.committed * 10_000n) / b.backing);
  console.log(`\n    wallet ${formatUnits(wallet, 18)} WETH · committed ${formatUnits(b.committed, 18)} WETH · utilisation ${(u / 100).toFixed(1)}%\n`);
  return { utilisationBps: u };
}

async function quoteAll(orders: Map<string, Order>, note: (key: string) => string) {
  for (const [key, order] of orders) {
    const td = await buildTakerData({ taker: taker.address, isAToB: true });
    try {
      const q = await pc.readContract({
        address: A.router, abi: SWAP_ABI, functionName: "quote",
        args: [order, PROBE_IN, td] as never, account: taker.address,
      }) as readonly [bigint, bigint, Hex];
      const px = Number(formatUnits(PROBE_IN, 6)) / Number(formatUnits(q[1], 18));
      console.log(`      strategy ${key}      bid ${px.toFixed(2).padStart(8)}${note(key)}`);
    } catch (e: any) {
      let data: string | undefined;
      for (let c: any = e; c && !data; c = c.cause) if (typeof c.data === "string" && c.data.startsWith("0x")) data = c.data;
      let msg = "reverted";
      if (data) {
        try {
          const d = decodeErrorResult({ abi: FLOOR_ERR, data: data as Hex });
          msg = `declined: SolvencyFloor (utilisation ${(Number(d.args![2]) / 100).toFixed(1)}% > ${(Number(d.args![3]) / 100).toFixed(0)}%)`;
        } catch { msg = data.slice(0, 20); }
      }
      console.log(`      strategy ${key}      ${msg}${note(key)}`);
    }
  }
}

console.log(`\n═══ WATCH A POSITION DEFEND ITSELF ═══`);
console.log(`  maker ${maker.address} · one wallet, three books\n`);

await fundEthIfNeeded();

// ── setup: mint, approve, ship A/B/C ─────────────────────────────────────────────
const orders = new Map<string, Order>();
const hashes = new Map<string, Hex>();
for (const b of BOOKS) {
  const prog = program()
    .solvencyFloor(A.solventBook, FLOOR_BPS)
    .solvencySkew(A.solventBook, b.skewStart, SKEW_MAX)
    .xyc().fee(b.fee);
  const order = await buildOrder({ maker: maker.address, tokenA: A.usdc, tokenB: A.weth, program: prog.encode() });
  orders.set(b.key, order);
  hashes.set(b.key, await orderHash(order));
}

// re-runnable: dock every strategy the index knows for this maker, reset the wallet, ship fresh
const prev = await gql<{ strategies: { id: Hex }[] }>(
  `{ strategies(where: { maker: "${maker.address.toLowerCase()}", active: true }, first: 100) { id } }`);
for (const st of prev.strategies) {
  await tx(maker, `dock previous strategy ${st.id.slice(0, 10)}`, {
    address: A.aqua, abi: AQUA_ABI, functionName: "dock",
    args: [A.router, st.id, [A.usdc, A.weth]],
  }, true);
}
async function setWallet(token: Hex, decimals: number, target: bigint, label: string) {
  const have = await pc.readContract({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [maker.address] }) as bigint;
  if (have < target) await tx(maker, `maker mint ${label}`, { address: token, abi: ERC20_ABI, functionName: "mint", args: [maker.address, target - have] }, true);
  if (have > target) await tx(maker, `maker trim ${label}`, { address: token, abi: ERC20_ABI, functionName: "transfer", args: [role("deployer").address, have - target] }, true);
}
await setWallet(A.weth, 18, parseUnits("10", 18), "WETH to 10");
await setWallet(A.usdc, 6, parseUnits("15000", 6), "USDC to 15000");
await ensureApproval(maker, A.weth, A.aqua, "maker approve Aqua (WETH)");
await ensureApproval(maker, A.usdc, A.aqua, "maker approve Aqua (USDC)");
let rc;
for (const b of BOOKS) {
  rc = await tx(maker, `ship strategy ${b.key} (1.5 WETH / 4650 USDC)`, {
    address: A.aqua, abi: AQUA_ABI, functionName: "ship",
    args: [A.router, encodeStrategy(orders.get(b.key)!), [A.usdc, A.weth], [USDC_PER_BOOK, WETH_PER_BOOK]],
  });
}
const lastBlock: bigint = rc!.blockNumber;

console.log(`\n[1] three books, one wallet - all healthy`);
await syncBooks(lastBlock);
await bookLine();
await quoteAll(orders, () => "");

// ── a taker fills A: normal business, the books barely move ──────────────────────
console.log(`\n[2] a taker fills strategy A (500 USDC) - fills are healthy`);
{
  const bal = await pc.readContract({ address: A.usdc, abi: ERC20_ABI, functionName: "balanceOf", args: [taker.address] }) as bigint;
  if (bal < TRADE_IN) await tx(taker, "taker mint USDC", { address: A.usdc, abi: ERC20_ABI, functionName: "mint", args: [taker.address, TRADE_IN - bal] }, true);
  await ensureApproval(taker, A.usdc, A.router, "taker approve router");
  const td = await buildTakerData({ taker: taker.address, isAToB: true });
  const rc = await tx(taker, "taker swap on A", { address: A.router, abi: SWAP_ABI, functionName: "swap", args: [orders.get("A")!, TRADE_IN, td] });
  await syncBooks(rc.blockNumber);
}
await bookLine();
await quoteAll(orders, (k) => (k === "A" ? "      ← just filled, still quoting" : ""));

// ── the maker redeploys inventory: the mainnet story, and the books push back ────
async function redeployTo(targetUtilBps: bigint, label: string) {
  const b = await pc.readContract({
    address: A.solventBook, abi: BOOK_ABI, functionName: "bookOf", args: [maker.address, A.weth],
  }) as { committed: bigint; backing: bigint };
  const targetBacking = (b.committed * 10_000n) / targetUtilBps;
  const wallet = await pc.readContract({ address: A.weth, abi: ERC20_ABI, functionName: "balanceOf", args: [maker.address] }) as bigint;
  const out = wallet - targetBacking;
  if (out <= 0n) { console.log(`  = wallet already at target`); return; }
  const rc = await tx(maker, label, {
    address: A.weth, abi: ERC20_ABI, functionName: "transfer", args: [role("deployer").address, out],
  });
  await syncBooks(rc.blockNumber);
}

console.log(`\n[3] the maker redeploys most of the wallet to another venue`);
console.log(`    (exactly what mainnet makers do - nothing on Aqua stops it)`);
await redeployTo(8_700n, "maker moves WETH out (to ~87% utilisation)");
await bookLine();
await quoteAll(orders, (k) => (k === "B" ? "      ← spread widened itself, no keeper, no dock" : ""));

console.log(`\n[4] the maker keeps going - past the floor`);
await redeployTo(9_900n, "maker moves more WETH out (past the 95% floor)");
await bookLine();
await quoteAll(orders, (k) => (k === "C" ? "      ← nothing for a taker to waste gas on" : ""));

console.log(`\n  Before Solvent these books would quote the stale price until settlement`);
console.log(`  reverted in a taker's face. Here they priced the risk, then refused it.\n`);
