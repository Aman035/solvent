import { env } from "./env.js";

export interface AgentRow {
  id: `0x${string}`;
  honoredCount: number;
  failedCount: number;
  honoredValueUsd6: string;
  distinctTakers: number;
  diversityBps: number;
  settlementScore: string;
  onChainScore: string;
  reviewCount: number;
  reviewAvgBps: number;
  counterparties?: { taker: `0x${string}`; fillCount: number; valueUsd6: string }[];
}

export interface FillRow {
  id: string;
  maker: { id: `0x${string}` };
  taker: { id: `0x${string}` };
  tokenIn: string; tokenOut: string;
  amountIn: string; amountOut: string;
  valueUsd6: string;
  status: "HONORED" | "FAILED";
  blockNumber: string; timestamp: string; txHash: string;
}

export class SubgraphError extends Error {}

/** Statuses worth retrying: rate limits and gateway hiccups. */
const RETRYABLE = new Set([429, 502, 503, 504]);

export async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const url = env.SUBGRAPH_URL;
  if (!url) throw new SubgraphError("SUBGRAPH_URL is not set");
  let res: Response;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (!RETRYABLE.has(res.status) || attempt >= 4) break;
    // back off 2s, 4s, 8s, 16s - or whatever the server asks for
    const asked = Number(res.headers.get("retry-after"));
    const wait = Number.isFinite(asked) && asked > 0 ? asked * 1000 : 2000 * 2 ** attempt;
    await new Promise((r) => setTimeout(r, wait));
  }
  if (!res.ok) throw new SubgraphError(`subgraph HTTP ${res.status}`);
  const json = await res.json() as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new SubgraphError(json.errors.map((e) => e.message).join("; "));
  if (!json.data) throw new SubgraphError("empty subgraph response");
  return json.data;
}

const AGENT_FIELDS = `
  id honoredCount failedCount honoredValueUsd6 distinctTakers diversityBps
  settlementScore onChainScore reviewCount reviewAvgBps
`;

/** Health: how far behind chain head is the index? */
export async function subgraphHead(): Promise<{ block: number; hasIndexingErrors: boolean }> {
  const d = await gql<{ _meta: { block: { number: number }; hasIndexingErrors: boolean } }>(
    `{ _meta { block { number } hasIndexingErrors } }`);
  return { block: d._meta.block.number, hasIndexingErrors: d._meta.hasIndexingErrors };
}

/** Every agent with any delivery record, newest activity first. */
export async function agentsWithHistory(): Promise<AgentRow[]> {
  const d = await gql<{ agents: AgentRow[] }>(
    `{ agents(where: { honoredCount_gt: 0 }, orderBy: honoredValueUsd6, orderDirection: desc) {
        ${AGENT_FIELDS}
        counterparties(first: 100) { taker fillCount valueUsd6 }
      } }`);
  return d.agents;
}

/** Candidate makers for a pair - the query Bob reasons over. */
export async function candidates(): Promise<AgentRow[]> {
  const d = await gql<{ agents: AgentRow[] }>(
    `{ agents(orderBy: settlementScore, orderDirection: desc) {
        ${AGENT_FIELDS}
        strategies(where: { active: true }) { id hasReputationGate hasPriceAdjuster shippedTx }
      } }`);
  return d.agents;
}

/** Full fill history for one agent - the raw behaviour the LLM analyst reasons over. */
export async function agentFills(agent: string, first = 100): Promise<FillRow[]> {
  const d = await gql<{ fills: FillRow[] }>(
    `query($a: String!, $n: Int!) {
       fills(where: { maker: $a }, orderBy: blockNumber, orderDirection: desc, first: $n) {
         id maker { id } taker { id } tokenIn tokenOut amountIn amountOut
         valueUsd6 status blockNumber timestamp txHash
       } }`, { a: agent.toLowerCase(), n: first });
  return d.fills;
}
