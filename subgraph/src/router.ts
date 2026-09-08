import { Bytes } from "@graphprotocol/graph-ts";
import { Swapped } from "../generated/Router/SwapVMRouter";
import { Fill, Strategy, Counterparty } from "../generated/schema";
import { loadAgent, loadGlobal, counterpartyId, recomputeScore, toUsd6, ZERO } from "./shared";

/**
 * An HONORED fill.
 *
 * Upstream SwapVM already emits everything needed: maker, taker, tokens and amounts.
 * No custom event is required for the success path (see V10 in the verification report) -
 * `Swapped` joined to Aqua's `Pulled` IS the receipt that real tokens left the maker's
 * wallet.
 */
export function handleSwapped(event: Swapped): void {
  let maker = loadAgent(event.params.maker, event.block);
  let taker = loadAgent(event.params.taker, event.block);

  // Value delivered BY THE MAKER = the token flowing out to the taker.
  let valueUsd6 = toUsd6(event.params.tokenOut, event.params.amountOut);

  let id = event.transaction.hash.concatI32(event.logIndex.toI32());
  let f = new Fill(id);
  f.strategyHash = event.params.orderHash;
  let strat = Strategy.load(event.params.orderHash);
  if (strat != null) f.strategy = strat.id;
  f.maker = maker.id;
  f.taker = taker.id;
  f.tokenIn = event.params.tokenIn;
  f.tokenOut = event.params.tokenOut;
  f.amountIn = event.params.amountIn;
  f.amountOut = event.params.amountOut;
  f.valueUsd6 = valueUsd6;
  f.status = "HONORED";
  f.blockNumber = event.block.number;
  f.timestamp = event.block.timestamp;
  f.txHash = event.transaction.hash;
  f.save();

  // per-counterparty totals feed the Herfindahl diversity term
  let cpId = counterpartyId(event.params.maker, event.params.taker);
  let cp = Counterparty.load(cpId);
  if (cp == null) {
    cp = new Counterparty(cpId);
    cp.maker = maker.id;
    cp.taker = event.params.taker;
    cp.fillCount = 0;
    cp.valueUsd6 = ZERO;
    cp.firstBlock = event.block.number;
    maker.distinctTakers = maker.distinctTakers + 1;
  }
  cp.fillCount = cp.fillCount + 1;
  cp.valueUsd6 = cp.valueUsd6.plus(valueUsd6);
  cp.lastBlock = event.block.number;
  cp.save();

  maker.honoredCount = maker.honoredCount + 1;
  maker.honoredValueUsd6 = maker.honoredValueUsd6.plus(valueUsd6);

  // gather this maker's counterparty ids for the HHI recomputation
  let ids: Bytes[] = [];
  let cps = maker.counterparties.load();
  for (let i = 0; i < cps.length; i++) ids.push(cps[i].id);
  if (ids.length == 0) ids.push(cpId);
  recomputeScore(maker, ids);

  maker.save();
  taker.save();

  let g = loadGlobal(event.block);
  g.totalFills = g.totalFills + 1;
  g.totalHonored = g.totalHonored + 1;
  g.totalValueUsd6 = g.totalValueUsd6.plus(valueUsd6);
  g.save();
}
