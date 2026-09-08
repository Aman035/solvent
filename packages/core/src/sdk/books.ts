import { computeUtilisationBps } from "../book.js";
import type { SolventChainInfo } from "./chains.js";

/** A maker's balance sheet for one token, as maintained by the index. */
export interface MakerBook {
  maker: `0x${string}`;
  token: `0x${string}`;
  /** Sum of the maker's live virtual balances for this token (what is promised). */
  committed: bigint;
  /** min(wallet balance, allowance to Aqua) at the last touch (what can settle). */
  backing: bigint;
  /** committed * 10000 / backing, saturating at uint32.max when backing is zero. */
  utilisationBps: number;
  updatedAtBlock: bigint;
}

interface RawBook { maker: string; token: string; committed: string; backing: string; utilisationBps: string; updatedAtBlock: string }

function parseBook(b: RawBook): MakerBook {
  return {
    maker: b.maker as `0x${string}`, token: b.token as `0x${string}`,
    committed: BigInt(b.committed), backing: BigInt(b.backing),
    utilisationBps: Number(b.utilisationBps), updatedAtBlock: BigInt(b.updatedAtBlock),
  };
}

const FIELDS = "maker token committed backing utilisationBps updatedAtBlock";

export class BooksApi {
  constructor(private info: SolventChainInfo, private url: string) {}

  private async gql<T>(query: string): Promise<T> {
    const r = await fetch(this.url, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query }),
    });
    const j = (await r.json()) as { data?: T; errors?: { message: string }[] };
    if (j.errors?.length) throw new Error(`subgraph: ${j.errors[0].message}`);
    if (!j.data) throw new Error("subgraph: empty response");
    return j.data;
  }

  /** The largest books on this chain, most utilised first. */
  async top(first = 25): Promise<MakerBook[]> {
    const d = await this.gql<{ makerBooks: RawBook[] }>(
      `{ makerBooks(orderBy: utilisationBps, orderDirection: desc, first: ${Math.min(first, 1000)}, where: { committed_gt: "0" }) { ${FIELDS} } }`);
    return d.makerBooks.map(parseBook);
  }

  /** Every book for one maker. */
  async ofMaker(maker: string): Promise<MakerBook[]> {
    const d = await this.gql<{ makerBooks: RawBook[] }>(
      `{ makerBooks(where: { maker: "${maker.toLowerCase()}" }, first: 1000) { ${FIELDS} } }`);
    return d.makerBooks.map(parseBook);
  }

  /** One maker's book for one token, or null if the index has never seen the pair. */
  async get(maker: string, token: string): Promise<MakerBook | null> {
    const id = (maker + token.slice(2)).toLowerCase();
    const d = await this.gql<{ makerBook: RawBook | null }>(
      `{ makerBook(id: "${id}") { ${FIELDS} } }`);
    return d.makerBook ? parseBook(d.makerBook) : null;
  }

  /** Recompute utilisation exactly as the contract and the index do. */
  utilisationBps(committed: bigint, backing: bigint): number {
    return computeUtilisationBps(committed, backing);
  }

  /** Indexer head block and error flag - freshness before trust. */
  async health(): Promise<{ block: number; hasIndexingErrors: boolean }> {
    const d = await this.gql<{ _meta: { block: { number: number }; hasIndexingErrors: boolean } }>(
      `{ _meta { block { number } hasIndexingErrors } }`);
    return { block: d._meta.block.number, hasIndexingErrors: d._meta.hasIndexingErrors };
  }
}
