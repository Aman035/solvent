import { createPublicClient, http, type PublicClient } from "viem";
import { SOLVENT_CHAINS, SolventChain, ReadOnlyChainError, gatewayUrl, type SolventChainInfo } from "./chains.js";
import { BooksApi } from "./books.js";
import { ProgramBuilder, program } from "../program.js";

export interface SolventConfig {
  chain: SolventChain;
  /** Override the public default RPC. */
  rpcUrl?: string;
  /**
   * Your Graph gateway API key. When set, reads go to the index published on The Graph
   * Network (decentralized, no Studio rate limit), with Studio as the automatic fallback.
   */
  graphApiKey?: string;
  /** Override the Graph endpoint entirely (takes precedence over graphApiKey). */
  subgraphUrl?: string;
}

/**
 * The Solvent client. Reads work on every chain; anything that needs the
 * contracts (addresses, programs meant for quoting) is gated by chain mode.
 */
export class Solvent {
  readonly info: SolventChainInfo;
  readonly books: BooksApi;
  private pc?: PublicClient;
  private rpcUrl: string;

  constructor(cfg: SolventConfig) {
    this.info = SOLVENT_CHAINS[cfg.chain];
    if (!this.info) throw new Error(`unknown chain: ${cfg.chain}`);
    this.rpcUrl = cfg.rpcUrl ?? this.info.rpcUrl;
    const primary = cfg.subgraphUrl
      ?? (cfg.graphApiKey ? gatewayUrl(cfg.chain, cfg.graphApiKey) : this.info.subgraphUrl);
    // with a gateway key, Studio remains the fallback; an explicit override has none
    const fallback = !cfg.subgraphUrl && cfg.graphApiKey ? this.info.subgraphUrl : undefined;
    this.books = new BooksApi(this.info, primary, fallback);
  }

  /** "full" when Solvent contracts are live here; "read-only" when only the index is. */
  get mode() { return this.info.mode; }

  /** A viem public client on this chain (lazily constructed). */
  get publicClient(): PublicClient {
    return (this.pc ??= createPublicClient({ chain: this.info.viem, transport: http(this.rpcUrl) }));
  }

  /** Deployed Solvent contract addresses. Throws on index-only chains. */
  get contracts() {
    if (!this.info.contracts) throw new ReadOnlyChainError(this.info.chain, "contracts");
    return this.info.contracts;
  }

  /**
   * A SwapVM program builder preloaded with this chain's oracles, e.g.
   * `sdk.strategy().solvencyFloor(9500).solvencySkew(5000, 400000).xyc().fee(30000)`.
   * Throws on index-only chains - there is no router to run the program yet.
   */
  strategy(): SolventProgram {
    if (!this.info.contracts) throw new ReadOnlyChainError(this.info.chain, "strategy()");
    const c = this.info.contracts;
    return new SolventProgram(c.solventBook as `0x${string}`, c.score as `0x${string}`);
  }
}

/** ProgramBuilder wrapper that fills in the chain's oracle addresses. */
export class SolventProgram {
  private b: ProgramBuilder = program();
  constructor(private book: `0x${string}`, private scoreOracle: `0x${string}`) {}
  solvencyFloor(maxUtilisationBps: number) { this.b.solvencyFloor(this.book, maxUtilisationBps); return this; }
  solvencySkew(startBps: number, maxWidenBps: number) { this.b.solvencySkew(this.book, startBps, maxWidenBps); return this; }
  gate(minScore: number) { this.b.gate(this.scoreOracle, minScore); return this; }
  adjuster(minScore: number, widenBps: number) { this.b.widen(this.scoreOracle, minScore, widenBps); return this; }
  xyc() { this.b.xyc(); return this; }
  fee(feeBps1e7: number) { this.b.fee(feeBps1e7); return this; }
  encode(): `0x${string}` { return this.b.encode(); }
  describe(): string[] { return this.b.describe(); }
}

export function createSolvent(cfg: SolventConfig): Solvent { return new Solvent(cfg); }
