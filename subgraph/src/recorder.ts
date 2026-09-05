import { Bytes, BigInt } from "@graphprotocol/graph-ts";
import { FillFailed } from "../generated/ProofOfFillRecorder/ProofOfFillRecorder";
import { Fill, Strategy, Counterparty } from "../generated/schema";
import { loadAgent, loadGlobal, recomputeScore, toUsd6, ZERO } from "./shared";

/**
 * A BROKEN PROMISE.
 *
 * A reverted swap destroys its own logs, so the failure cannot be indexed from the
 * transaction itself. ProofOfFillRecorder re-emits it - either self-reported by a
 * taker contract, or observed by the attestor scanning status==0 receipts - always
 * citing the real reverted transaction.
 *
 * A failure does NOT add value; it damages the reliability term, so the maker's score
 * falls. Failures weigh 3x against honoured fills.
 */
export function handleFillFailed(event: FillFailed): void {
  let maker = loadAgent(event.params.maker, event.block);
  let taker = loadAgent(event.params.taker, event.block);

  let id = event.transaction.hash.concatI32(event.logIndex.toI32());
  let f = new Fill(id);
  f.strategyHash = event.params.strategyHash;
  let strat = Strategy.load(event.params.strategyHash);
  if (strat != null) f.strategy = strat.id;
  f.maker = maker.id;
  f.taker = taker.id;
  f.tokenIn = Bytes.empty();
  f.tokenOut = event.params.tokenOut;
  f.amountIn = ZERO;
  f.amountOut = event.params.amountOut;
  // A failed fill delivered NOTHING, so it contributes no honoured value. We still record
  // the USD size of the promise that was broken, for display.
  f.valueUsd6 = toUsd6(event.params.tokenOut, event.params.amountOut);
  f.status = "FAILED";
  f.reason = event.params.reason;
  f.failedTxHash = event.params.failedTxHash;
  f.source = event.params.source;
  f.blockNumber = event.block.number;
  f.timestamp = event.block.timestamp;
  f.txHash = event.transaction.hash;
  f.save();

  maker.failedCount = maker.failedCount + 1;

  let ids: Bytes[] = [];
  let cps = maker.counterparties.load();
  for (let i = 0; i < cps.length; i++) ids.push(cps[i].id);
  recomputeScore(maker, ids);   // reliability term drops -> score falls

  maker.save();
  taker.save();

  let g = loadGlobal(event.block);
  g.totalFills = g.totalFills + 1;
  g.totalFailed = g.totalFailed + 1;
  g.save();
}
