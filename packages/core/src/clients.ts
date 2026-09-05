import { createPublicClient, createWalletClient, http, fallback, type PublicClient } from "viem";
import { activeChain, type ChainConfig } from "./chains.js";
import type { HDAccount } from "viem/accounts";

/** Public client with automatic RPC failover (R8). */
export function publicClient(c: ChainConfig = activeChain): PublicClient {
  const transports = [http(c.rpc, { timeout: 20_000, retryCount: 3 })];
  if (c.rpcFallback) transports.push(http(c.rpcFallback, { timeout: 20_000, retryCount: 2 }));
  return createPublicClient({ chain: c.chain, transport: fallback(transports) }) as PublicClient;
}

export function walletClient(account: HDAccount, c: ChainConfig = activeChain) {
  const transports = [http(c.rpc, { timeout: 20_000, retryCount: 3 })];
  if (c.rpcFallback) transports.push(http(c.rpcFallback, { timeout: 20_000, retryCount: 2 }));
  return createWalletClient({ account, chain: c.chain, transport: fallback(transports) });
}
