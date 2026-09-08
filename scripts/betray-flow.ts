import { formatUnits, parseUnits, type Hex } from "viem";
import {
  readClient, publicClient, walletClient, role, addrs, program, buildOrder, buildTakerData,
  orderHash, ensureApproval, nextNonce, ERC20_ABI, SWAP_ABI, explorerTx, tx,
} from "@aqua-solvent/core";

const rd = readClient();
const pc = publicClient();
const A = addrs();
const alice = role("alice");
const bob = role("bob");

console.log(`\n╔══════════════════════════════════════════════════════════════════╗`);
console.log(`║  BROKEN PROMISE — a maker who cannot deliver                     ║`);
console.log(`╚══════════════════════════════════════════════════════════════════╝\n`);

const prog = program().gate(A.score, 0).xyc().fee(30_000);
const order = await buildOrder({ maker: alice.address, tokenA: A.usdc, tokenB: A.weth, program: prog.encode() });
const sh = await orderHash(order);

const amt = parseUnits("300", 6);
const b = await rd.readContract({ address: A.usdc, abi: ERC20_ABI, functionName: "balanceOf", args: [bob.address] }) as bigint;
if (b < amt) await tx(bob, "bob mint USDC", { address: A.usdc, abi: ERC20_ABI, functionName: "mint", args: [bob.address, amt - b] }, true);
await ensureApproval(bob, A.usdc, A.router, "bob approve");

const td = await buildTakerData({ taker: bob.address, isAToB: true });

// A quote still succeeds - the AMM maths is fine. Only the transfer fails.
const q = await rd.readContract({
  address: A.router, abi: SWAP_ABI, functionName: "quote",
  args: [order, amt, td] as never, account: bob.address,
}) as readonly [bigint, bigint, Hex];
console.log(`  quote says Alice will deliver ${formatUnits(q[1], 18)} pofWETH for 300 pofUSDC`);
console.log(`  her wallet holds ${formatUnits(await rd.readContract({ address: A.weth, abi: ERC20_ABI, functionName: "balanceOf", args: [alice.address] }) as bigint, 18)} pofWETH\n`);

/*
 * Send with an EXPLICIT gas limit.
 *
 * viem would normally simulate first, see the revert and refuse to broadcast - leaving
 * no on-chain trace. We want the transaction to actually land and fail, because THAT
 * reverted transaction is the public record of the broken promise, permanently visible
 * on the explorer. It is also what the attestor scans for.
 */
const wc = walletClient(bob);
const nonce = await nextNonce(pc, bob.address);
console.log(`  Bob attempts the fill anyway…`);
const hash = await wc.writeContract({
  address: A.router, abi: SWAP_ABI, functionName: "swap",
  args: [order, amt, td] as never, nonce, gas: 600_000n,
});
const rc = await pc.waitForTransactionReceipt({ hash });

console.log(`\n  tx     ${explorerTx(hash)}`);
console.log(`  status ${rc.status}  gas used ${rc.gasUsed}`);
console.log(`  logs   ${rc.logs.length}   ← a full revert destroys every log`);
console.log(`\n  ${rc.status === "reverted" ? "⛔ ALICE FAILED TO DELIVER — recorded on-chain forever" : "❌ unexpectedly succeeded"}`);
console.log(`\n  Nothing in this transaction is indexable by a subgraph.`);
console.log(`  That is exactly the gap SolventRecorder closes.\n`);

// hand the failure to the attestor
const out = { failedTxHash: hash, strategyHash: sh, maker: alice.address, taker: bob.address, tokenOut: A.weth, amountOut: q[1].toString() };
console.log(`  → run: pnpm attest:failures\n`);
console.log(JSON.stringify(out, null, 2));
