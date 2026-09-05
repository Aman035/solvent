import { formatUnits, parseUnits, encodeAbiParameters, parseAbiParameters, type Hex } from "viem";
import {
  publicClient, walletClient, role, readManifest, program, explorerTx, activeChain, nextNonce,
} from "@pof/core";

const pc = publicClient();
const m = readManifest().contracts;
const AQUA = m.aqua.address as Hex;
const ROUTER = m.router.address as Hex;
const SCORE = m.proofOfFillScore.address as Hex;
const HELPER = m.helper.address as Hex;
const USDC = m.usdc.address as Hex;   // tokenA (lower address)
const WETH = m.weth.address as Hex;   // tokenB

const alice = role("alice");
const bob = role("bob");
const aliceW = walletClient(alice);
const bobW = walletClient(bob);

const erc20 = [
  { name: "mint", type: "function", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [] },
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

const MAKER_ARGS = "(address maker,address receiver,address tokenA,address tokenB,bool shouldUnwrapWeth,bool useAquaInsteadOfSignature,bool allowZeroAmountIn,bool hasPreTransferInHook,bool hasPostTransferInHook,bool hasPreTransferOutHook,bool hasPostTransferOutHook,address preTransferInTarget,bytes preTransferInData,address postTransferInTarget,bytes postTransferInData,address preTransferOutTarget,bytes preTransferOutData,address postTransferOutTarget,bytes postTransferOutData,bytes program)";
const ORDER = "(address maker,uint256 traits,bytes data)";

const helperAbi = [
  { name: "buildOrder", type: "function", stateMutability: "pure",
    inputs: [{ type: "tuple", name: "args", components: parseTuple(MAKER_ARGS) }],
    outputs: [{ type: "tuple", name: "", components: parseTuple(ORDER) }] },
] as const;

function parseTuple(sig: string) {
  return sig.slice(1, -1).split(",").map((f) => {
    const [type, name] = f.trim().split(/\s+/);
    return { type, name };
  });
}

const MAX = (1n << 256n) - 1n;
const log = (s: string) => console.log(s);

async function send(w: typeof aliceW, label: string, req: any) {
  const nonce = await nextNonce(pc, w.account.address);
  const hash = await w.writeContract({ ...req, nonce });
  const rc = await pc.waitForTransactionReceipt({ hash });
  log(`    ${rc.status === "success" ? "✅" : "❌"} ${label.padEnd(30)} ${explorerTx(hash)}`);
  if (rc.status !== "success") throw new Error(`${label} reverted`);
  return rc;
}

log(`\n═══ VERTICAL SLICE — ${activeChain.key} ═══\n`);

// ---- 1. mint + approve --------------------------------------------------
log("  [1] Alice provisions and approves Aqua");
await send(aliceW, "mint 5 pofWETH", { address: WETH, abi: erc20, functionName: "mint", args: [alice.address, parseUnits("5", 18)] });
await send(aliceW, "mint 10,000 pofUSDC", { address: USDC, abi: erc20, functionName: "mint", args: [alice.address, parseUnits("10000", 6)] });
await send(aliceW, "approve Aqua (WETH)", { address: WETH, abi: erc20, functionName: "approve", args: [AQUA, MAX] });
await send(aliceW, "approve Aqua (USDC)", { address: USDC, abi: erc20, functionName: "approve", args: [AQUA, MAX] });

// ---- 2. build the program in TypeScript --------------------------------
const prog = program().gate(SCORE, 0).xyc().fee(30_000);
log(`\n  [2] program: [${prog.describe().join("][")}]`);
log(`      bytes  : ${prog.encode()}`);

// ---- 3. encode the Order via the on-chain official libraries ------------
const order = await pc.readContract({
  address: HELPER, abi: helperAbi, functionName: "buildOrder",
  args: [{
    maker: alice.address, receiver: "0x0000000000000000000000000000000000000000",
    tokenA: USDC, tokenB: WETH,
    shouldUnwrapWeth: false, useAquaInsteadOfSignature: true, allowZeroAmountIn: false,
    hasPreTransferInHook: false, hasPostTransferInHook: false,
    hasPreTransferOutHook: false, hasPostTransferOutHook: false,
    preTransferInTarget: "0x0000000000000000000000000000000000000000", preTransferInData: "0x",
    postTransferInTarget: "0x0000000000000000000000000000000000000000", postTransferInData: "0x",
    preTransferOutTarget: "0x0000000000000000000000000000000000000000", preTransferOutData: "0x",
    postTransferOutTarget: "0x0000000000000000000000000000000000000000", postTransferOutData: "0x",
    program: prog.encode(),
  }] as never,
}) as { maker: Hex; traits: bigint; data: Hex };
log(`\n  [3] order built via on-chain official libs`);
log(`      maker=${order.maker}  traits=0x${order.traits.toString(16)}  data=${order.data.length} chars`);

// ---- 4. ship to Aqua ----------------------------------------------------
const strategy = encodeAbiParameters(parseAbiParameters(`${ORDER}`), [order] as never);
const aquaAbi = [
  { name: "ship", type: "function", stateMutability: "nonpayable",
    inputs: [{ type: "address" }, { type: "bytes" }, { type: "address[]" }, { type: "uint256[]" }],
    outputs: [{ type: "bytes32" }] },
  { name: "safeBalances", type: "function", stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }, { type: "bytes32" }, { type: "address" }, { type: "address" }],
    outputs: [{ type: "uint256" }, { type: "uint256" }] },
] as const;

const hashAbi = [{ name: "hash", type: "function", stateMutability: "view",
  inputs: [{ type: "tuple", components: parseTuple(ORDER) }], outputs: [{ type: "bytes32" }] }] as const;
const strategyHash = await pc.readContract({
  address: ROUTER, abi: hashAbi, functionName: "hash", args: [order] as never }) as Hex;

const [balU, balW] = await pc.readContract({
  address: AQUA, abi: aquaAbi, functionName: "safeBalances",
  args: [alice.address, ROUTER, strategyHash, USDC, WETH] }) as readonly [bigint, bigint];

const wethBefore = await pc.readContract({ address: WETH, abi: erc20, functionName: "balanceOf", args: [alice.address] }) as bigint;
log(`\n  [4] Alice ships 10,000 USDC / 5 WETH to Aqua`);
log(`      strategyHash: ${strategyHash}`);
// Aqua strategies are IMMUTABLE - re-shipping the same program reverts, so this is idempotent.
if (balU > 0n || balW > 0n) {
  log(`      = already shipped (aqua balances ${formatUnits(balU, 6)} USDC / ${formatUnits(balW, 18)} WETH) - skipping`);
} else {
  await send(aliceW, "aqua.ship", {
    address: AQUA, abi: aquaAbi, functionName: "ship",
    args: [ROUTER, strategy, [USDC, WETH], [parseUnits("10000", 6), parseUnits("5", 18)]],
  });
}
const wethAfter = await pc.readContract({ address: WETH, abi: erc20, functionName: "balanceOf", args: [alice.address] }) as bigint;
log(`      wallet WETH before ship: ${formatUnits(wethBefore, 18)}`);
log(`      wallet WETH after  ship: ${formatUnits(wethAfter, 18)}`);
log(`      ${wethBefore === wethAfter ? "✅ NEVER DEPOSITED — tokens stayed in Alice's wallet" : "❌ tokens moved"}`);

// ---- 5. Bob provisions ---------------------------------------------------
log(`\n  [5] Bob provisions and approves the router`);
await send(bobW, "mint 2,500 pofUSDC", { address: USDC, abi: erc20, functionName: "mint", args: [bob.address, parseUnits("2500", 6)] });
await send(bobW, "approve router (USDC)", { address: USDC, abi: erc20, functionName: "approve", args: [ROUTER, MAX] });

// ---- 6. taker data via the official libs --------------------------------
const TAKER_ARGS = "(address taker,bool isExactIn,bool shouldUnwrapWeth,bool isStrictThresholdAmount,bool isFirstTransferFromTaker,bool useTransferFromAndAquaPush,bool isAToB,bool allowPartialFill,bytes threshold,address to,uint40 deadline,bool hasPreTransferInCallback,bool hasPreTransferOutCallback,bytes preTransferInHookData,bytes postTransferInHookData,bytes preTransferOutHookData,bytes postTransferOutHookData,bytes preTransferInCallbackData,bytes preTransferOutCallbackData,bytes instructionsArgs,bytes signature)";
const takerAbi = [
  { name: "buildTakerData", type: "function", stateMutability: "pure",
    inputs: [{ type: "tuple", name: "args", components: parseTuple(TAKER_ARGS) }],
    outputs: [{ type: "bytes" }] },
] as const;

const takerData = await pc.readContract({
  address: HELPER, abi: takerAbi, functionName: "buildTakerData",
  args: [{
    taker: bob.address, isExactIn: true, shouldUnwrapWeth: false,
    isStrictThresholdAmount: false, isFirstTransferFromTaker: true,
    useTransferFromAndAquaPush: true, isAToB: true, allowPartialFill: false,
    threshold: "0x", to: bob.address, deadline: 0,
    hasPreTransferInCallback: false, hasPreTransferOutCallback: false,
    preTransferInHookData: "0x", postTransferInHookData: "0x",
    preTransferOutHookData: "0x", postTransferOutHookData: "0x",
    preTransferInCallbackData: "0x", preTransferOutCallbackData: "0x",
    instructionsArgs: "0x", signature: "0x",
  }] as never,
}) as Hex;
log(`      takerData: ${takerData.length} chars`);

// ---- 7. quote then swap --------------------------------------------------
const swapAbi = [
  { name: "quote", type: "function", stateMutability: "view",
    inputs: [{ type: "tuple", components: parseTuple(ORDER) }, { type: "uint256" }, { type: "bytes" }],
    outputs: [{ type: "uint256" }, { type: "uint256" }, { type: "bytes32" }] },
  { name: "swap", type: "function", stateMutability: "payable",
    inputs: [{ type: "tuple", components: parseTuple(ORDER) }, { type: "uint256" }, { type: "bytes" }],
    outputs: [{ type: "uint256" }, { type: "uint256" }, { type: "bytes32" }] },
] as const;

const amountIn = parseUnits("2500", 6);
const q = await pc.readContract({
  address: ROUTER, abi: swapAbi, functionName: "quote",
  args: [order, amountIn, takerData] as never, account: bob.address,
}) as readonly [bigint, bigint, Hex];
log(`\n  [6] quote: ${formatUnits(q[0], 6)} pofUSDC -> ${formatUnits(q[1], 18)} pofWETH`);

log(`\n  [7] Bob swaps — THE FILL`);
const rc = await send(bobW, "router.swap", {
  address: ROUTER, abi: swapAbi, functionName: "swap", args: [order, amountIn, takerData],
});

// Read balances at EXPLICIT block numbers around the fill. Reading at "latest" is
// unreliable behind a fallback transport: the follow-up read can land on a node that
// has not yet imported the block, and silently reports no transfer.
const bal = async (token: Hex, who: Hex, blockNumber: bigint) =>
  await pc.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [who], blockNumber }) as bigint;
const B = rc.blockNumber - 1n, A = rc.blockNumber;
const balBefore = { aliceW: await bal(WETH, alice.address, B), aliceU: await bal(USDC, alice.address, B), bobW: await bal(WETH, bob.address, B) };
const balAfter  = { aliceW: await bal(WETH, alice.address, A), aliceU: await bal(USDC, alice.address, A), bobW: await bal(WETH, bob.address, A) };

log(`\n  ── settlement ──`);
log(`      Alice WETH : ${formatUnits(balBefore.aliceW, 18)} -> ${formatUnits(balAfter.aliceW, 18)}  (${formatUnits(balAfter.aliceW - balBefore.aliceW, 18)})`);
log(`      Alice USDC : ${formatUnits(balBefore.aliceU, 6)} -> ${formatUnits(balAfter.aliceU, 6)}  (+${formatUnits(balAfter.aliceU - balBefore.aliceU, 6)})`);
log(`      Bob   WETH : ${formatUnits(balBefore.bobW, 18)} -> ${formatUnits(balAfter.bobW, 18)}  (+${formatUnits(balAfter.bobW - balBefore.bobW, 18)})`);
log(`      logs in tx : ${rc.logs.length}`);
const moved = balAfter.aliceW < balBefore.aliceW && balAfter.bobW > balBefore.bobW;
log(`\n  ${moved ? "✅ HONORED FILL — real tokens left Alice's wallet, no vault" : "❌ no transfer"}\n`);
