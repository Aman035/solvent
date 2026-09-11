import { base, baseSepolia, arbitrum, optimism, type Chain as ViemChain } from "viem/chains";
import { BASE_SEPOLIA_DEPLOYMENT } from "./deployments.js";

/** Chains the Solvent SDK knows about. */
export enum SolventChain {
  BaseSepolia = "base-sepolia",
  Base = "base",
  Arbitrum = "arbitrum",
  Optimism = "optimism",
}

/**
 * What a chain supports.
 * - "full": Solvent contracts are deployed - quotes, programs, and the index.
 * - "read-only": only the balance-sheet index exists (it watches the official
 *   1inch Aqua deployment); every write or quote path throws ReadOnlyChainError.
 */
export type ChainMode = "full" | "read-only";

export interface SolventChainInfo {
  chain: SolventChain;
  mode: ChainMode;
  chainId: number;
  viem: ViemChain;
  /** Public default; override per client for private endpoints. */
  rpcUrl: string;
  explorer: string;
  /** The Aqua registry this chain's index watches. */
  aqua: `0x${string}`;
  /** Public Graph endpoint for this chain's Solvent index. */
  subgraphUrl: string;
  /** Contract addresses - present only on "full" chains. */
  contracts?: typeof BASE_SEPOLIA_DEPLOYMENT;
}

const OFFICIAL_AQUA = "0x1111113ccf1426a8e30e2bff5e005d929bf6a90a" as const;
const STUDIO = "https://api.studio.thegraph.com/query/42912";

export const SOLVENT_CHAINS: Record<SolventChain, SolventChainInfo> = {
  [SolventChain.BaseSepolia]: {
    chain: SolventChain.BaseSepolia, mode: "full", chainId: 84532, viem: baseSepolia,
    rpcUrl: "https://sepolia.base.org", explorer: "https://sepolia.basescan.org",
    aqua: BASE_SEPOLIA_DEPLOYMENT.aqua as `0x${string}`,
    subgraphUrl: `${STUDIO}/aqua-solvent-base-sepolia/v0.8.0`,
    contracts: BASE_SEPOLIA_DEPLOYMENT,
  },
  [SolventChain.Base]: {
    chain: SolventChain.Base, mode: "read-only", chainId: 8453, viem: base,
    rpcUrl: "https://mainnet.base.org", explorer: "https://basescan.org",
    aqua: OFFICIAL_AQUA, subgraphUrl: `${STUDIO}/aqua-solvent-base/v0.2.0`,
  },
  [SolventChain.Arbitrum]: {
    chain: SolventChain.Arbitrum, mode: "read-only", chainId: 42161, viem: arbitrum,
    rpcUrl: "https://arb1.arbitrum.io/rpc", explorer: "https://arbiscan.io",
    aqua: OFFICIAL_AQUA, subgraphUrl: `${STUDIO}/aqua-solvent-arbitrum/v0.2.0`,
  },
  [SolventChain.Optimism]: {
    chain: SolventChain.Optimism, mode: "read-only", chainId: 10, viem: optimism,
    rpcUrl: "https://mainnet.optimism.io", explorer: "https://optimistic.etherscan.io",
    aqua: OFFICIAL_AQUA, subgraphUrl: `${STUDIO}/aqua-solvent-optimism/v0.2.0`,
  },
};

/** Thrown when a write or quote path is used on a chain that only has the index. */
export class ReadOnlyChainError extends Error {
  constructor(chain: SolventChain, feature: string) {
    super(`${feature} needs Solvent contracts, and ${chain} is index-only today. ` +
      `Full mode is live on ${SolventChain.BaseSepolia}; mainnet deployment is coming.`);
    this.name = "ReadOnlyChainError";
  }
}
