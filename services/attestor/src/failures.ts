import { decodeFunctionData, type Hex } from "viem";
import {
  readClient, addrs, role, tx, SWAP_ABI, orderHash, explorerTx, type Order,
} from "@solvent/core";

/**
 * Failure scanner.
 *
 * A maker who cannot deliver causes the taker's swap to REVERT, and a full revert
 * destroys every log in the transaction - so the failure is invisible to the subgraph
 * even though the reverted transaction sits permanently on the explorer.
 *
 * This scans for `status == 0` receipts targeting the router, decodes the attempted
 * swap to recover the maker and strategy, and re-emits the failure through
 * ProofOfFillRecorder citing the real failed transaction hash. Anyone can check the
 * citation; the attestor cannot invent a failure the chain does not corroborate.
 */

const RECORDER_ABI = [
  { name: "recordFailure", type: "function", stateMutability: "nonpayable",
    inputs: [
      { type: "bytes32", name: "strategyHash" }, { type: "address", name: "maker" },
      { type: "address", name: "taker" }, { type: "address", name: "tokenOut" },
      { type: "uint256", name: "amountOut" }, { type: "bytes4", name: "reason" },
      { type: "bytes32", name: "failedTxHash" },
    ], outputs: [] },
  { name: "recorded", type: "function", stateMutability: "view",
    inputs: [{ type: "bytes32" }], outputs: [{ type: "bool" }] },
] as const;

/** 1inch SafeERC20 normalises every transferFrom failure to this selector (V2/V10). */
export const SAFE_TRANSFER_FROM_FAILED = "0xf4059071" as Hex;

export interface FoundFailure {
  txHash: Hex; blockNumber: bigint; taker: Hex; maker: Hex;
  strategyHash: Hex; amountIn: bigint; reason: Hex;
}

export async function scanForFailures(fromBlock: bigint, toBlock: bigint): Promise<FoundFailure[]> {
  const rd = readClient();
  const A = addrs();
  const found: FoundFailure[] = [];

  for (let b = fromBlock; b <= toBlock; b++) {
    const block = await rd.getBlock({ blockNumber: b, includeTransactions: true });
    for (const t of block.transactions as any[]) {
      if (!t.to || t.to.toLowerCase() !== A.router.toLowerCase()) continue;
      const rc = await rd.getTransactionReceipt({ hash: t.hash });
      if (rc.status === "success") continue;

      // Recover what was attempted from the calldata itself.
      let order: Order; let amountIn: bigint;
      try {
        const d = decodeFunctionData({ abi: SWAP_ABI, data: t.input });
        if (d.functionName !== "swap") continue;
        order = (d.args as any)[0] as Order;
        amountIn = (d.args as any)[1] as bigint;
      } catch { continue; }

      // Re-run the call at the failing block to recover the exact revert selector.
      let reason: Hex = "0x00000000";
      try {
        await rd.call({ to: A.router, data: t.input, account: t.from, blockNumber: b - 1n });
      } catch (e: any) {
        for (let c: any = e; c; c = c.cause) {
          if (typeof c.data === "string" && c.data.startsWith("0x") && c.data.length >= 10) { reason = c.data.slice(0, 10) as Hex; break; }
        }
      }

      found.push({
        txHash: t.hash, blockNumber: b, taker: t.from as Hex, maker: order.maker,
        strategyHash: await orderHash(order), amountIn, reason,
      });
    }
  }
  return found;
}

export async function recordFailures(failures: FoundFailure[]): Promise<number> {
  const rd = readClient();
  const A = addrs();
  const attestor = role("attestor");
  let n = 0;

  for (const f of failures) {
    const already = await rd.readContract({ address: A.recorder, abi: RECORDER_ABI, functionName: "recorded", args: [f.txHash] }) as boolean;
    if (already) { console.log(`    = ${f.txHash.slice(0, 12)}… already recorded`); continue; }

    console.log(`    ⛔ ${f.maker.slice(0, 10)} failed to deliver to ${f.taker.slice(0, 10)}`);
    console.log(`       reason ${f.reason}${f.reason === SAFE_TRANSFER_FROM_FAILED ? " (SafeTransferFromFailed — maker could not deliver)" : ""}`);
    console.log(`       proof  ${explorerTx(f.txHash)}`);
    await tx(attestor, "recordFailure", {
      address: A.recorder, abi: RECORDER_ABI, functionName: "recordFailure",
      args: [f.strategyHash, f.maker, f.taker, A.weth, 0n, f.reason, f.txHash],
    });
    n++;
  }
  return n;
}
