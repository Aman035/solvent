import { baseSepolia, base, type Chain } from "viem/chains";
import { env } from "./env.js";

/**
 * Chain-agnostic config. Everything downstream reads from here so that
 * switching to Base mainnet is a TARGET_CHAIN change, not a code change.
 */
export type ChainKey = "base-sepolia" | "base";

export interface ChainConfig {
  key: ChainKey;
  chain: Chain;
  chainId: number;
  rpc: string;
  rpcFallback?: string;
  explorer: string;
  /** Subgraph Studio network identifier (subgraph.yaml `network:`) */
  subgraphNetwork: string;
  /** Official Aqua deployment, if one exists on this chain. */
  officialAqua?: `0x${string}`;
  /** Canonical ERC-8004 registries, if deployed on this chain. */
  erc8004?: { identity?: `0x${string}`; reputation?: `0x${string}`; validation?: `0x${string}` };
}

const CHAINS: Record<ChainKey, ChainConfig> = {
  "base-sepolia": {
    key: "base-sepolia",
    chain: baseSepolia,
    chainId: 84532,
    rpc: env.BASE_SEPOLIA_RPC,
    rpcFallback: env.BASE_SEPOLIA_RPC_FALLBACK,
    explorer: "https://sepolia.basescan.org",
    subgraphNetwork: "base-sepolia",
    // no official Aqua and no ERC-8004 here -> we deploy both (V5)
  },
  base: {
    key: "base",
    chain: base,
    chainId: 8453,
    rpc: env.BASE_MAINNET_RPC ?? "https://mainnet.base.org",
    explorer: "https://basescan.org",
    subgraphNetwork: "base",
    officialAqua: "0x499943e74fb0ce105688beee8ef2abec5d936d31",
    erc8004: {
      identity: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
      reputation: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
      // validation: none deployed as of 2026-09-05 (V5)
    },
  },
};

export const activeChain: ChainConfig = CHAINS[env.TARGET_CHAIN];
export function chainConfig(key: ChainKey): ChainConfig { return CHAINS[key]; }
export function explorerTx(hash: string, c: ChainConfig = activeChain) { return `${c.explorer}/tx/${hash}`; }
export function explorerAddr(a: string, c: ChainConfig = activeChain) { return `${c.explorer}/address/${a}`; }
