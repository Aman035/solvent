/**
 * The quote desk's chain plumbing. Everything here is an eth_call: helper.buildOrder
 * and buildTakerData are pure, router.quote is view, so a judge needs no wallet to
 * pull real quotes out of the deployed router.
 */
import {
  createPublicClient, http, decodeErrorResult, parseAbi, type Hex,
} from "viem";
import { baseSepolia } from "viem/chains";
import manifest from "../../deployments/84532.json";
import { RPC_URL, SUBGRAPH_URL } from "./data";
import { postJSON } from "./poll";

const C = manifest.contracts as Record<string, { address: Hex }>;
export const ADDR = {
  router: C.router.address, helper: C.helper.address, aqua: C.aqua.address,
  book: C.solventBook.address, weth: C.weth.address, usdc: C.usdc.address,
};
/** The vignette maker: one wallet, three self-defending books. */
export const MAKER = "0xcF66ABC4e23809135F349c36625b5BF41aF0Df01" as Hex;
/** Any address works for read-only quoting; this one is obviously a probe. */
const PROBE_TAKER = "0x0000000000000000000000000000000000000001" as Hex;

export const pc = createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) });

const sig = (s: string) => s.slice(1, -1).split(",").map((f) => {
  const [type, name] = f.trim().split(/\s+/); return { type, name };
});
const MAKER_ARGS = sig("(address maker,address receiver,address tokenA,address tokenB,bool shouldUnwrapWeth,bool useAquaInsteadOfSignature,bool allowZeroAmountIn,bool hasPreTransferInHook,bool hasPostTransferInHook,bool hasPreTransferOutHook,bool hasPostTransferOutHook,address preTransferInTarget,bytes preTransferInData,address postTransferInTarget,bytes postTransferInData,address preTransferOutTarget,bytes preTransferOutData,address postTransferOutTarget,bytes postTransferOutData,bytes program)");
const TAKER_ARGS = sig("(address taker,bool isExactIn,bool shouldUnwrapWeth,bool isStrictThresholdAmount,bool isFirstTransferFromTaker,bool useTransferFromAndAquaPush,bool isAToB,bool allowPartialFill,bytes threshold,address to,uint40 deadline,bool hasPreTransferInCallback,bool hasPreTransferOutCallback,bytes preTransferInHookData,bytes postTransferInHookData,bytes preTransferOutHookData,bytes postTransferOutHookData,bytes preTransferInCallbackData,bytes preTransferOutCallbackData,bytes instructionsArgs,bytes signature)");
const ORDER = sig("(address maker,uint256 traits,bytes data)");

const HELPER_ABI = [
  { name: "buildOrder", type: "function", stateMutability: "pure",
    inputs: [{ type: "tuple", name: "args", components: MAKER_ARGS }],
    outputs: [{ type: "tuple", components: ORDER }] },
  { name: "buildTakerData", type: "function", stateMutability: "pure",
    inputs: [{ type: "tuple", name: "args", components: TAKER_ARGS }],
    outputs: [{ type: "bytes" }] },
] as const;
const ROUTER_ABI = [
  { name: "quote", type: "function", stateMutability: "view",
    inputs: [{ type: "tuple", components: ORDER }, { type: "uint256" }, { type: "bytes" }],
    outputs: [{ type: "uint256" }, { type: "uint256" }, { type: "bytes32" }] },
  { name: "swap", type: "function", stateMutability: "payable",
    inputs: [{ type: "tuple", components: ORDER }, { type: "uint256" }, { type: "bytes" }],
    outputs: [{ type: "uint256" }, { type: "uint256" }, { type: "bytes32" }] },
] as const;
export { ROUTER_ABI };
const BOOK_ABI = [
  { name: "bookOf", type: "function", stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }],
    outputs: [{ type: "tuple", components: [
      { type: "uint128", name: "committed" }, { type: "uint128", name: "backing" }, { type: "uint64", name: "updatedAt" }] }] },
] as const;
const AQUA_ABI = [
  { name: "safeBalances", type: "function", stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }, { type: "bytes32" }, { type: "address" }, { type: "address" }],
    outputs: [{ type: "uint256" }, { type: "uint256" }] },
] as const;
export const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address, address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
  "function mint(address, uint256)",
]);
const FLOOR_ERR = parseAbi([
  "error MakerBeyondSolvencyFloor(address maker, address token, uint32 utilisationBps, uint32 maxUtilisationBps)"]);

const KNOWN_ERRS = parseAbi([
  "error MakerBeyondSolvencyFloor(address maker, address token, uint32 utilisationBps, uint32 maxUtilisationBps)",
  "error TakerBelowReputationFloor(address taker, uint32 score, uint32 floor)",
  "error SafeTransferFromFailed()",
  "error SafeTransferFailed()",
]);

/** Turn any viem revert into one legible line: decoded custom error, reason string, or raw selector. */
export function explainRevert(e: unknown): string {
  let data: string | undefined;
  for (let c = e as { data?: string; cause?: unknown } | undefined; c && !data; c = c.cause as never)
    if (typeof c.data === "string" && c.data.startsWith("0x") && c.data.length >= 10) data = c.data;
  if (data) {
    try {
      const d = decodeErrorResult({ abi: KNOWN_ERRS, data: data as Hex }) as unknown as { errorName: string; args?: readonly unknown[] };
      if (d.errorName === "MakerBeyondSolvencyFloor")
        return `declined by SolvencyFloor: book ${(Number(d.args![2]) / 100).toFixed(1)}% utilised, floor ${(Number(d.args![3]) / 100).toFixed(0)}%`;
      if (d.errorName === "TakerBelowReputationFloor")
        return `declined by ReputationGate: score ${d.args![1]} below floor ${d.args![2]}`;
      if (d.errorName === "SafeTransferFromFailed" || d.errorName === "SafeTransferFailed")
        return "token transfer failed: check balance and allowance (the maker's or yours)";
      return `${d.errorName}(${(d.args ?? []).join(", ")})`;
    } catch { return `reverted with ${data.slice(0, 10)} (unrecognised error)`; }
  }
  const msg = ((e as { shortMessage?: string }).shortMessage ?? (e as Error).message ?? "failed");
  return msg.replace(/\s*\n+\s*/g, " · ").slice(0, 180);
}

export interface Order { maker: Hex; traits: bigint; data: Hex }

export interface DeskStrategy {
  key: string;            // A, B, C
  hash: Hex;
  program: Hex;
  order: Order;
  floorBps: number;       // from SolvencyFloor args
  skewStartBps: number;   // from SolvencySkew args
  skewMaxWiden: number;   // 1e7 denominated
  feeBps1e7: number;      // FeeFlatIn
  usdcReserve: bigint;    // live virtual balances
  wethReserve: bigint;
}

/** Parse [opcode][len][args] for the four instructions the desk cares about. */
function parseProgram(program: Hex) {
  const b = program.slice(2);
  let i = 0, floorBps = 0, skewStartBps = 0, skewMaxWiden = 0, feeBps1e7 = 0;
  while (i + 4 <= b.length) {
    const op = parseInt(b.slice(i, i + 2), 16);
    const len = parseInt(b.slice(i + 2, i + 4), 16);
    const args = b.slice(i + 4, i + 4 + len * 2);
    if (op === 0x22) floorBps = parseInt(args.slice(40, 48), 16);
    if (op === 0xb5) { skewStartBps = parseInt(args.slice(40, 48), 16); skewMaxWiden = parseInt(args.slice(48, 54), 16); }
    if (op === 0x70) feeBps1e7 = parseInt(args.slice(0, 6), 16);
    i += 4 + len * 2;
  }
  return { floorBps, skewStartBps, skewMaxWiden, feeBps1e7 };
}

export async function loadStrategies(): Promise<DeskStrategy[]> {
  const j = await postJSON<{ data: { strategies: { id: Hex; program: Hex }[] } }>(SUBGRAPH_URL,
    { query: `{ strategies(where: { maker: "${MAKER.toLowerCase()}", active: true }, orderBy: shippedAtBlock, first: 3) { id program } }` });
  const out: DeskStrategy[] = [];
  for (const [n, s] of (j.data.strategies as { id: Hex; program: Hex }[]).entries()) {
    const order = await pc.readContract({
      address: ADDR.helper, abi: HELPER_ABI, functionName: "buildOrder",
      args: [{
        maker: MAKER, receiver: "0x0000000000000000000000000000000000000000",
        tokenA: ADDR.usdc, tokenB: ADDR.weth,
        shouldUnwrapWeth: false, useAquaInsteadOfSignature: true, allowZeroAmountIn: false,
        hasPreTransferInHook: false, hasPostTransferInHook: false,
        hasPreTransferOutHook: false, hasPostTransferOutHook: false,
        preTransferInTarget: "0x0000000000000000000000000000000000000000", preTransferInData: "0x",
        postTransferInTarget: "0x0000000000000000000000000000000000000000", postTransferInData: "0x",
        preTransferOutTarget: "0x0000000000000000000000000000000000000000", preTransferOutData: "0x",
        postTransferOutTarget: "0x0000000000000000000000000000000000000000", postTransferOutData: "0x",
        program: s.program,
      }] as never,
    }) as unknown as Order;
    let usdcReserve = 0n, wethReserve = 0n;
    try {
      const [a, b2] = await pc.readContract({
        address: ADDR.aqua, abi: AQUA_ABI, functionName: "safeBalances",
        args: [MAKER, ADDR.router, s.id, ADDR.usdc, ADDR.weth],
      }) as readonly [bigint, bigint];
      usdcReserve = a; wethReserve = b2;
    } catch { /* docked mid-session */ }
    out.push({ key: "ABC"[n] ?? String(n), hash: s.id, program: s.program, order, ...parseProgram(s.program), usdcReserve, wethReserve });
  }
  return out;
}

export async function takerData(taker: Hex): Promise<Hex> {
  return await pc.readContract({
    address: ADDR.helper, abi: HELPER_ABI, functionName: "buildTakerData",
    args: [{
      taker, isExactIn: true, shouldUnwrapWeth: false,
      isStrictThresholdAmount: false, isFirstTransferFromTaker: true,
      useTransferFromAndAquaPush: true, isAToB: true, allowPartialFill: false,
      threshold: "0x", to: taker, deadline: 0,
      hasPreTransferInCallback: false, hasPreTransferOutCallback: false,
      preTransferInHookData: "0x", postTransferInHookData: "0x",
      preTransferOutHookData: "0x", postTransferOutHookData: "0x",
      preTransferInCallbackData: "0x", preTransferOutCallbackData: "0x",
      instructionsArgs: "0x", signature: "0x",
    }] as never,
  }) as Hex;
}

export type QuoteResult =
  | { ok: true; amountOut: bigint }
  | { ok: false; utilisationBps: number; maxUtilisationBps: number };

/** A real quote from the deployed router, or its decoded refusal. */
export async function liveQuote(s: DeskStrategy, usdcIn: bigint, taker: Hex = PROBE_TAKER): Promise<QuoteResult> {
  const td = await takerData(taker);
  try {
    const q = await pc.readContract({
      address: ADDR.router, abi: ROUTER_ABI, functionName: "quote",
      args: [s.order, usdcIn, td] as never, account: taker,
    }) as readonly [bigint, bigint, Hex];
    return { ok: true, amountOut: q[1] };
  } catch (e: unknown) {
    let data: string | undefined;
    for (let c = e as { data?: string; cause?: unknown } | undefined; c && !data; c = c.cause as never)
      if (typeof c.data === "string" && c.data.startsWith("0x")) data = c.data;
    if (data) {
      try {
        const d = decodeErrorResult({ abi: FLOOR_ERR, data: data as Hex });
        return { ok: false, utilisationBps: Number(d.args![2]), maxUtilisationBps: Number(d.args![3]) };
      } catch { /* not the floor error */ }
    }
    throw e;
  }
}

/** The maker's WETH book: oracle numbers plus the wallet's balance read live. */
export async function liveBook(): Promise<{ committed: bigint; backing: bigint; wallet: bigint }> {
  const [b, wallet] = await Promise.all([
    pc.readContract({
      address: ADDR.book, abi: BOOK_ABI, functionName: "bookOf", args: [MAKER, ADDR.weth],
    }) as Promise<{ committed: bigint; backing: bigint }>,
    pc.readContract({ address: ADDR.weth, abi: ERC20_ABI, functionName: "balanceOf", args: [MAKER] }),
  ]);
  return { committed: b.committed, backing: b.backing, wallet };
}

/** One oracle row, for overlaying live truth onto the indexed table. */
export async function readOracleBook(maker: string, token: string): Promise<{ committed: bigint; backing: bigint }> {
  const b = await pc.readContract({
    address: ADDR.book, abi: BOOK_ABI, functionName: "bookOf", args: [maker as Hex, token as Hex],
  }) as { committed: bigint; backing: bigint };
  return { committed: b.committed, backing: b.backing };
}

// ── the mirror math: bit-exact ports of the contract formulas ────────────────
export const U32_MAX = 0xffffffff;
export function utilisationBps(committed: bigint, backing: bigint): number {
  if (committed === 0n) return 0;
  if (backing === 0n) return U32_MAX;
  const v = (committed * 10_000n) / backing;
  return v > BigInt(U32_MAX) ? U32_MAX : Number(v);
}
export function widenFor(u: number, startBps: number, maxWiden: number): number {
  if (u <= startBps) return 0;
  const span = 10_000 - startBps;
  const over = u >= 10_000 ? span : u - startBps;
  return Math.floor((maxWiden * over) / span);
}
const BPS7 = 10_000_000n;
/** XYCSwap exact-in with FeeFlatIn semantics: fee then skew widen, like the program. */
export function simulateQuote(s: DeskStrategy, usdcIn: bigint, hypotheticalBacking: bigint, committed: bigint): QuoteResult {
  const u = utilisationBps(committed, hypotheticalBacking);
  if (s.floorBps && u >= s.floorBps) return { ok: false, utilisationBps: u, maxUtilisationBps: s.floorBps };
  const widen = widenFor(u, s.skewStartBps, s.skewMaxWiden);
  // exact-in: both rates reduce the effective input, mirroring FeeFlatIn's math
  let inAfter = usdcIn - ceilDiv(usdcIn * BigInt(s.feeBps1e7), BPS7);
  inAfter = inAfter - ceilDiv(inAfter * BigInt(widen), BPS7);
  if (s.usdcReserve + inAfter === 0n) return { ok: true, amountOut: 0n };
  const out = (s.wethReserve * inAfter) / (s.usdcReserve + inAfter);
  return { ok: true, amountOut: out };
}
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
