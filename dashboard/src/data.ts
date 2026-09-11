import { postJSON } from "./poll";
declare const __SUBGRAPH_URL__: string;
declare const __RPC_URL__: string;
declare const __EXPLORER__: string;
declare const __STUDIO__: string;

export const SUBGRAPH_URL = __SUBGRAPH_URL__;
export const RPC_URL = __RPC_URL__;
export const EXPLORER = __EXPLORER__;
export const STUDIO = __STUDIO__;

export interface Review { id: string; reviewer: string; value: string; txHash: string }
export interface Counterparty { taker: string; fillCount: number; valueUsd6: string }
export interface Strategy { id: string; active: boolean; hasReputationGate: boolean; hasPriceAdjuster: boolean; shippedTx: string; program: string }

/** SwapVM opcode names, for decoding a shipped program into readable chips. */
const OPCODES: Record<number, string> = {
  0x00: "Stop", 0x02: "Salt", 0x04: "Extruction", 0x20: "Deadline",
  0x21: "ReputationGate", 0x22: "SolvencyFloor", 0x50: "XYCSwap", 0x51: "XYCConcentrate",
  0x58: "PeggedSwap", 0x70: "FeeFlatIn", 0x71: "FeeFlatOut",
  0x80: "FeeProtocol", 0x9c: "Decay", 0xb0: "RequireMinRate", 0xb3: "ReputationPriceAdjuster", 0xb5: "SolvencySkew",
};
/** The four instructions Solvent added to SwapVM. */
export const OURS = new Set([0x21, 0x22, 0xb3, 0xb5]);

/** Walk the [opcode][argsLen][args] stream. */
export function decodeProgram(program: string): { opcode: number; name: string; ours: boolean }[] {
  const b = program.startsWith("0x") ? program.slice(2) : program;
  const out: { opcode: number; name: string; ours: boolean }[] = [];
  let i = 0;
  while (i + 4 <= b.length) {
    const op = parseInt(b.slice(i, i + 2), 16);
    const len = parseInt(b.slice(i + 2, i + 4), 16);
    if (Number.isNaN(op) || Number.isNaN(len)) break;
    out.push({ opcode: op, name: OPCODES[op] ?? `0x${op.toString(16).padStart(2, "0")}`, ours: OURS.has(op) });
    i += 4 + len * 2;
  }
  return out;
}
export interface Agent {
  id: string; agentId: string | null;
  reviewCount: number; reviewAvgBps: number;
  honoredCount: number; failedCount: number; honoredValueUsd6: string;
  distinctTakers: number; diversityBps: number;
  settlementScore: string; onChainScore: string;
  reviews: Review[]; counterparties: Counterparty[]; strategies: Strategy[];
}
export interface Fill {
  id: string; status: "HONORED" | "FAILED";
  maker: { id: string }; taker: { id: string };
  amountIn: string; amountOut: string; valueUsd6: string;
  tokenIn: string; tokenOut: string;
  reason: string | null; failedTxHash: string | null; source: number | null;
  blockNumber: string; timestamp: string; txHash: string;
}
export interface Snapshot {
  agents: Agent[]; fills: Fill[];
  global: { totalFills: number; totalHonored: number; totalFailed: number; totalValueUsd6: string; lastBlock: string } | null;
  head: number; chainHead: number; indexingErrors: boolean;
}

const QUERY = `{
  _meta { block { number } hasIndexingErrors }
  global(id: "global") { totalFills totalHonored totalFailed totalValueUsd6 lastBlock }
  agents(where: { or: [{ reviewCount_gt: 0 }, { honoredCount_gt: 0 }] }, orderBy: settlementScore, orderDirection: desc) {
    id agentId reviewCount reviewAvgBps honoredCount failedCount honoredValueUsd6
    distinctTakers diversityBps settlementScore onChainScore
    reviews(first: 40) { id reviewer value txHash }
    counterparties(first: 40) { taker fillCount valueUsd6 }
    strategies(where: { active: true }, first: 5) { id active hasReputationGate hasPriceAdjuster shippedTx program }
  }
  fills(orderBy: blockNumber, orderDirection: desc, first: 40) {
    id status maker { id } taker { id } amountIn amountOut valueUsd6
    tokenIn tokenOut reason failedTxHash source blockNumber timestamp txHash
  }
}`;

async function chainHead(): Promise<number> {
  try {
    const r = await fetch(RPC_URL, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
    });
    const j = await r.json();
    return parseInt(j.result, 16);
  } catch { return 0; }
}

export async function fetchSnapshot(): Promise<Snapshot> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [j, head] = await Promise.all([postJSON<any>(SUBGRAPH_URL, { query: QUERY }), chainHead()]);
  if (j.errors?.length) throw new Error(j.errors[0].message);
  return {
    agents: j.data.agents, fills: j.data.fills, global: j.data.global,
    head: j.data._meta.block.number, chainHead: head,
    indexingErrors: j.data._meta.hasIndexingErrors,
  };
}

// ---- formatting -----------------------------------------------------------
export const usd = (v: string | number, dp = 2) =>
  (Number(v) / 1e6).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
export const stars = (bps: number) => (bps / 10000).toFixed(2);
export const short = (a: string, n = 4) => `${a.slice(0, 2 + n)}…${a.slice(-n)}`;
export const txUrl = (h: string) => `${EXPLORER}/tx/${h}`;
export const addrUrl = (a: string) => `${EXPLORER}/address/${a}`;

/** Known demo identities, so the ledger reads in names rather than hex. */
export const NAMES: Record<string, string> = {};
export function nameOf(addr: string) {
  return NAMES[addr.toLowerCase()] ?? short(addr);
}
export function registerNames(map: Record<string, string>) {
  for (const [k, v] of Object.entries(map)) NAMES[k.toLowerCase()] = v;
}

export function ago(ts: string | number) {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - Number(ts)));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

// ---- maker balance sheets (Solvent) ---------------------------------------
declare const __SUBGRAPH_URL_BASE__: string;
declare const __SUBGRAPH_URL_ARBITRUM__: string;
declare const __SUBGRAPH_URL_OPTIMISM__: string;
export const SUBGRAPH_URL_BASE = __SUBGRAPH_URL_BASE__;
export const SUBGRAPH_URL_ARBITRUM = __SUBGRAPH_URL_ARBITRUM__;
export const SUBGRAPH_URL_OPTIMISM = __SUBGRAPH_URL_OPTIMISM__;

export interface MakerBook {
  maker: string; token: string;
  committed: string; backing: string;
  utilisationBps: string; updatedAtBlock: string;
}
export interface BooksSnapshot { books: MakerBook[]; head: number; indexingErrors: boolean }

const BOOKS_QUERY = `{
  _meta { block { number } hasIndexingErrors }
  makerBooks(orderBy: committed, orderDirection: desc, first: 200) {
    maker token committed backing utilisationBps updatedAtBlock
  }
}`;

export async function fetchBooks(url: string): Promise<BooksSnapshot> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const j = await postJSON<any>(url, { query: BOOKS_QUERY });
  if (j.errors?.length) throw new Error(j.errors[0].message);
  return { books: j.data.makerBooks, head: j.data._meta.block.number, indexingErrors: j.data._meta.hasIndexingErrors };
}
