import { encodeAbiParameters, parseAbiParameters, type Hex, type PublicClient } from "viem";
import type { LocalAccount } from "viem/accounts";
import { publicClient, readClient, walletClient, nextNonce } from "./clients.js";
import { readManifest } from "./manifest.js";
import { explorerTx } from "./chains.js";

const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as const;
export const MAX_UINT = (1n << 256n) - 1n;

export const MAKER_ARGS_SIG =
  "(address maker,address receiver,address tokenA,address tokenB,bool shouldUnwrapWeth,bool useAquaInsteadOfSignature,bool allowZeroAmountIn,bool hasPreTransferInHook,bool hasPostTransferInHook,bool hasPreTransferOutHook,bool hasPostTransferOutHook,address preTransferInTarget,bytes preTransferInData,address postTransferInTarget,bytes postTransferInData,address preTransferOutTarget,bytes preTransferOutData,address postTransferOutTarget,bytes postTransferOutData,bytes program)";
export const TAKER_ARGS_SIG =
  "(address taker,bool isExactIn,bool shouldUnwrapWeth,bool isStrictThresholdAmount,bool isFirstTransferFromTaker,bool useTransferFromAndAquaPush,bool isAToB,bool allowPartialFill,bytes threshold,address to,uint40 deadline,bool hasPreTransferInCallback,bool hasPreTransferOutCallback,bytes preTransferInHookData,bytes postTransferInHookData,bytes preTransferOutHookData,bytes postTransferOutHookData,bytes preTransferInCallbackData,bytes preTransferOutCallbackData,bytes instructionsArgs,bytes signature)";
export const ORDER_SIG = "(address maker,uint256 traits,bytes data)";

export function tupleComponents(sig: string) {
  return sig.slice(1, -1).split(",").map((f) => {
    const [type, name] = f.trim().split(/\s+/);
    return { type, name };
  });
}

export interface Order { maker: Hex; traits: bigint; data: Hex }

export const ERC20_ABI = [
  { name: "mint", type: "function", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [] },
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  { name: "allowance", type: "function", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "transfer", type: "function", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

export const AQUA_ABI = [
  { name: "ship", type: "function", stateMutability: "nonpayable",
    inputs: [{ type: "address" }, { type: "bytes" }, { type: "address[]" }, { type: "uint256[]" }], outputs: [{ type: "bytes32" }] },
  { name: "dock", type: "function", stateMutability: "nonpayable",
    inputs: [{ type: "address" }, { type: "bytes32" }, { type: "address[]" }], outputs: [] },
  { name: "safeBalances", type: "function", stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }, { type: "bytes32" }, { type: "address" }, { type: "address" }],
    outputs: [{ type: "uint256" }, { type: "uint256" }] },
] as const;

export const SWAP_ABI = [
  { name: "hash", type: "function", stateMutability: "view",
    inputs: [{ type: "tuple", components: tupleComponents(ORDER_SIG) }], outputs: [{ type: "bytes32" }] },
  { name: "quote", type: "function", stateMutability: "view",
    inputs: [{ type: "tuple", components: tupleComponents(ORDER_SIG) }, { type: "uint256" }, { type: "bytes" }],
    outputs: [{ type: "uint256" }, { type: "uint256" }, { type: "bytes32" }] },
  { name: "swap", type: "function", stateMutability: "payable",
    inputs: [{ type: "tuple", components: tupleComponents(ORDER_SIG) }, { type: "uint256" }, { type: "bytes" }],
    outputs: [{ type: "uint256" }, { type: "uint256" }, { type: "bytes32" }] },
] as const;

const HELPER_ABI = [
  { name: "buildOrder", type: "function", stateMutability: "pure",
    inputs: [{ type: "tuple", name: "args", components: tupleComponents(MAKER_ARGS_SIG) }],
    outputs: [{ type: "tuple", components: tupleComponents(ORDER_SIG) }] },
  { name: "buildTakerData", type: "function", stateMutability: "pure",
    inputs: [{ type: "tuple", name: "args", components: tupleComponents(TAKER_ARGS_SIG) }],
    outputs: [{ type: "bytes" }] },
] as const;

export function addrs() {
  const c = readManifest().contracts;
  return {
    aqua: c.aqua.address as Hex, router: c.router.address as Hex,
    score: c.score.address as Hex, helper: c.helper.address as Hex,
    recorder: c.recorder.address as Hex,
    solventBook: c.solventBook.address as Hex,
    usdc: c.usdc.address as Hex, weth: c.weth.address as Hex,
  };
}

/** Build an Order using 1inch's OWN MakerTraits encoder, via the on-chain helper. */
export async function buildOrder(opts: {
  maker: Hex; tokenA: Hex; tokenB: Hex; program: Hex; pc?: PublicClient;
}): Promise<Order> {
  const pc = opts.pc ?? readClient();
  return await pc.readContract({
    address: addrs().helper, abi: HELPER_ABI, functionName: "buildOrder",
    args: [{
      maker: opts.maker, receiver: ZERO_ADDR, tokenA: opts.tokenA, tokenB: opts.tokenB,
      shouldUnwrapWeth: false, useAquaInsteadOfSignature: true, allowZeroAmountIn: false,
      hasPreTransferInHook: false, hasPostTransferInHook: false,
      hasPreTransferOutHook: false, hasPostTransferOutHook: false,
      preTransferInTarget: ZERO_ADDR, preTransferInData: "0x",
      postTransferInTarget: ZERO_ADDR, postTransferInData: "0x",
      preTransferOutTarget: ZERO_ADDR, preTransferOutData: "0x",
      postTransferOutTarget: ZERO_ADDR, postTransferOutData: "0x",
      program: opts.program,
    }] as never,
  }) as unknown as Order;
}

/** Build taker data for a plain EOA taker (transferFrom + aqua.push path). */
export async function buildTakerData(opts: {
  taker: Hex; isAToB: boolean; isExactIn?: boolean; pc?: PublicClient;
}): Promise<Hex> {
  const pc = opts.pc ?? readClient();
  return await pc.readContract({
    address: addrs().helper, abi: HELPER_ABI, functionName: "buildTakerData",
    args: [{
      taker: opts.taker, isExactIn: opts.isExactIn ?? true, shouldUnwrapWeth: false,
      isStrictThresholdAmount: false, isFirstTransferFromTaker: true,
      useTransferFromAndAquaPush: true, isAToB: opts.isAToB, allowPartialFill: false,
      threshold: "0x", to: opts.taker, deadline: 0,
      hasPreTransferInCallback: false, hasPreTransferOutCallback: false,
      preTransferInHookData: "0x", postTransferInHookData: "0x",
      preTransferOutHookData: "0x", postTransferOutHookData: "0x",
      preTransferInCallbackData: "0x", preTransferOutCallbackData: "0x",
      instructionsArgs: "0x", signature: "0x",
    }] as never,
  }) as Hex;
}

export function encodeStrategy(order: Order): Hex {
  return encodeAbiParameters(parseAbiParameters(ORDER_SIG), [order] as never);
}

export async function orderHash(order: Order, pc: PublicClient = readClient()): Promise<Hex> {
  return await pc.readContract({
    address: addrs().router, abi: SWAP_ABI, functionName: "hash", args: [order] as never,
  }) as Hex;
}

/** Send a write with explicit nonce management; returns the receipt. */
export async function tx(account: LocalAccount, label: string, req: any, quiet = false) {
  const pc = publicClient();
  const wc = walletClient(account);
  const nonce = await nextNonce(pc, account.address);
  const hash = await wc.writeContract({ ...req, nonce });
  const rc = await pc.waitForTransactionReceipt({ hash });
  if (!quiet) console.log(`    ${rc.status === "success" ? "✅" : "❌"} ${label.padEnd(28)} ${explorerTx(hash)}`);
  if (rc.status !== "success") throw new Error(`${label} reverted (${hash})`);

  // Ensure the READ node has imported this block before the caller reads state back.
  // Without this, a follow-up read can be served by a node that has not caught up and
  // silently reports pre-transaction state.
  const rd = readClient();
  for (let i = 0; i < 40; i++) {
    if ((await rd.getBlockNumber()) >= rc.blockNumber) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  return rc;
}

/** Approve only if the current allowance is insufficient. */
export async function ensureApproval(account: LocalAccount, token: Hex, spender: Hex, label: string) {
  const pc = readClient();
  const cur = await pc.readContract({ address: token, abi: ERC20_ABI, functionName: "allowance", args: [account.address, spender] }) as bigint;
  if (cur > MAX_UINT / 2n) return false;
  await tx(account, label, { address: token, abi: ERC20_ABI, functionName: "approve", args: [spender, MAX_UINT] });
  return true;
}

/**
 * Aqua balances for a strategy, or null if it was never shipped.
 *
 * `safeBalances` REVERTS with SafeBalancesForTokenNotInActiveStrategy for an unknown or
 * docked strategy, so it cannot be used directly as an existence check.
 */
export async function strategyBalances(
  maker: Hex, strategyHash: Hex, token0: Hex, token1: Hex,
): Promise<{ token0: bigint; token1: bigint } | null> {
  const pc = readClient();
  try {
    const r = await pc.readContract({
      address: addrs().aqua, abi: AQUA_ABI, functionName: "safeBalances",
      args: [maker, addrs().router, strategyHash, token0, token1],
    }) as readonly [bigint, bigint];
    return { token0: r[0], token1: r[1] };
  } catch {
    return null;   // not an active strategy
  }
}
