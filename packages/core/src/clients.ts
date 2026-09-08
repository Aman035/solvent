import { createPublicClient, createWalletClient, http, fallback, type PublicClient, type WalletClient, type Transport, type Chain} from "viem";
import { activeChain, type ChainConfig } from "./chains.js";
import type { HDAccount } from "viem/accounts";

/**
 * READ client - primary RPC only, no fallback.
 *
 * The public fallback endpoint lags behind and is NOT an archive node, which produced
 * two nasty bug classes: a confirmed transfer reading back as "no transfer", and
 * pinned-block reads failing with "Requested resource not found". Reads must be
 * consistent, so they go to the primary endpoint exclusively; the fallback exists for
 * write redundancy, where a stale read cannot silently corrupt a conclusion.
 */
export function readClient(c: ChainConfig = activeChain): PublicClient {
  // Ordered failover: the primary is always preferred (consistency, archive depth),
  // the public fallback only serves reads while the primary is unreachable. Without
  // this, a primary outage fails every chain-touching check at once.
  const transports = [http(c.rpc, { timeout: 25_000, retryCount: 2 })];
  if (c.rpcFallback) transports.push(http(c.rpcFallback, { timeout: 25_000, retryCount: 2 }));
  return createPublicClient({ chain: c.chain, transport: fallback(transports, { rank: false }) }) as PublicClient;
}

/** Public client with automatic RPC failover (R8). Use for writes and receipts. */
export function publicClient(c: ChainConfig = activeChain): PublicClient {
  const transports = [http(c.rpc, { timeout: 20_000, retryCount: 3 })];
  if (c.rpcFallback) transports.push(http(c.rpcFallback, { timeout: 20_000, retryCount: 2 }));
  return createPublicClient({ chain: c.chain, transport: fallback(transports) }) as PublicClient;
}

export function walletClient(account: HDAccount, c: ChainConfig = activeChain): WalletClient<Transport, Chain, HDAccount> {
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
