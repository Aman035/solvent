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

/**
 * Sequential transaction sender with explicit nonce tracking.
 *
 * Public RPCs frequently return a stale `getTransactionCount` immediately after a
 * confirmation, so back-to-back writes from one account race and fail with
 * "nonce too low". We fetch the nonce once per account and increment locally.
 */
const nonces = new Map<string, number>();

export async function nextNonce(pc: PublicClient, address: `0x${string}`): Promise<number> {
  const cached = nonces.get(address);
  if (cached !== undefined) { nonces.set(address, cached + 1); return cached; }
  const n = await pc.getTransactionCount({ address, blockTag: "pending" });
  nonces.set(address, n + 1);
  return n;
}

export function resetNonces() { nonces.clear(); }
