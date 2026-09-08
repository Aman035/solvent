import { formatUnits, parseUnits, decodeErrorResult, parseAbi, type Hex } from "viem";
import {
  readClient, role, addrs, program, buildOrder, buildTakerData, encodeStrategy,
  orderHash, tx, ensureApproval, strategyBalances, ERC20_ABI, AQUA_ABI, SWAP_ABI, explorerTx,
} from "@aqua-solvent/core";

const pc = readClient();
const A = addrs();
const alice = role("alice"), bob = role("bob"), poor = role("poorTaker");
const FLOOR = 1_000;

const SCORE_ABI = [{ name: "scoreOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint32" }] }] as const;
const scoreOf = async (a: Hex) => await pc.readContract({ address: A.score, abi: SCORE_ABI, functionName: "scoreOf", args: [a] }) as number;
const GATE_ERR = parseAbi(["error TakerBelowReputationFloor(address taker, uint32 score, uint32 floor)"]);

console.log(`\n═══ ReputationGate ENFORCEMENT — floor ${FLOOR} ═══\n`);
const sBob = await scoreOf(bob.address), sPoor = await scoreOf(poor.address);
console.log(`  bob        score ${String(sBob).padStart(5)}  ${sBob >= FLOOR ? "≥ floor → should PASS" : "< floor → should be REFUSED"}`);
console.log(`  poorTaker  score ${String(sPoor).padStart(5)}  ${sPoor >= FLOOR ? "≥ floor → should PASS" : "< floor → should be REFUSED"}`);

// Alice ships a strategy whose program carries the gate at a real floor.
const prog = program().gate(A.score, FLOOR).xyc().fee(30_000);
const order = await buildOrder({ maker: alice.address, tokenA: A.usdc, tokenB: A.weth, program: prog.encode() });
const sh = await orderHash(order);
console.log(`\n  [1] Alice ships a GATED strategy`);
console.log(`      program [${prog.describe().join("][")}]  floor=${FLOOR}`);
console.log(`      hash    ${sh}`);

const bal = await strategyBalances(alice.address, sh, A.usdc, A.weth);
if (bal === null || (bal.token0 === 0n && bal.token1 === 0n)) {
  await tx(alice, "alice mint 8 WETH", { address: A.weth, abi: ERC20_ABI, functionName: "mint", args: [alice.address, parseUnits("8", 18)] });
  await tx(alice, "alice mint 16k USDC", { address: A.usdc, abi: ERC20_ABI, functionName: "mint", args: [alice.address, parseUnits("16000", 6)] });
  await ensureApproval(alice, A.weth, A.aqua, "alice approve Aqua (WETH)");
  await ensureApproval(alice, A.usdc, A.aqua, "alice approve Aqua (USDC)");
  await tx(alice, "alice ships GATED", {
    address: A.aqua, abi: AQUA_ABI, functionName: "ship",
    args: [A.router, encodeStrategy(order), [A.usdc, A.weth], [parseUnits("16000", 6), parseUnits("8", 18)]],
  });
} else {
  console.log(`      = already shipped (${formatUnits(bal.token0, 6)} USDC / ${formatUnits(bal.token1, 18)} WETH)`);
}

async function attempt(who: typeof bob, label: string, expectPass: boolean) {
  const amt = parseUnits("500", 6);
  const b = await pc.readContract({ address: A.usdc, abi: ERC20_ABI, functionName: "balanceOf", args: [who.address] }) as bigint;
  if (b < amt) await tx(who, `${label} mint USDC`, { address: A.usdc, abi: ERC20_ABI, functionName: "mint", args: [who.address, amt - b] }, true);
  await ensureApproval(who, A.usdc, A.router, `${label} approve`);
  const td = await buildTakerData({ taker: who.address, isAToB: true });

  console.log(`\n  [${expectPass ? "2" : "3"}] ${label} (score ${await scoreOf(who.address)}) attempts a 500 USDC swap`);
  try {
    // quote() runs the gate too - a refusal is visible BEFORE any gas is spent on a swap
    const q = await pc.readContract({ address: A.router, abi: SWAP_ABI, functionName: "quote", args: [order, amt, td] as never, account: who.address }) as readonly [bigint, bigint, Hex];
    console.log(`      quote  ✅ ${formatUnits(q[1], 18)} pofWETH`);
    const rc = await tx(who, `${label} swap`, { address: A.router, abi: SWAP_ABI, functionName: "swap", args: [order, amt, td] });
    console.log(`      ${expectPass ? "✅ ADMITTED" : "❌ UNEXPECTEDLY ADMITTED"} — ${explorerTx(rc.transactionHash)}`);
  } catch (e: any) {
    // viem nests the revert payload down the cause chain; walk it to recover the args.
    let data: string | undefined;
    for (let c: any = e; c && !data; c = c.cause) if (typeof c.data === "string" && c.data.startsWith("0x")) data = c.data;
    if (!data) data = String(e.shortMessage ?? e.message).match(/0x[a-fA-F0-9]{8,}/)?.[0];

    let decoded = data ?? String(e.shortMessage ?? e.message).slice(0, 90);
    if (data && data.length > 10) {
      try {
        const d = decodeErrorResult({ abi: GATE_ERR, data: data as Hex });
        const [taker, score, floor] = d.args as unknown as [Hex, number, number];
        decoded = `${d.errorName}(taker=${taker}, score=${score}, floor=${floor})`;
      } catch { /* leave raw */ }
    }
    console.log(`      quote  ⛔ REFUSED AT QUOTE TIME`);
    console.log(`      ${expectPass ? "❌ UNEXPECTED REFUSAL" : "✅ REFUSED"} — ${decoded}`);
  }
}

await attempt(bob, "bob", true);
await attempt(poor, "poorTaker", false);
console.log("");
