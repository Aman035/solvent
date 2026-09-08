import { ScoreUpdated } from "../generated/Score/Score";
import { ScoreSnapshot } from "../generated/schema";
import { loadAgent } from "./shared";

/** Mirrors what the attestor actually wrote on-chain, so the UI can show both the
 *  subgraph-derived score and the on-chain cached score side by side. */
export function handleScoreUpdated(event: ScoreUpdated): void {
  let agent = loadAgent(event.params.account, event.block);
  agent.onChainScore = event.params.score;
  agent.save();

  let snap = new ScoreSnapshot(event.transaction.hash.concatI32(event.logIndex.toI32()));
  snap.agent = agent.id;
  snap.score = event.params.score;
  snap.honoredValueUsd6 = event.params.honoredValueUsd6;
  snap.honoredCount = event.params.honoredCount.toI32();
  snap.failedCount = event.params.failedCount.toI32();
  snap.diversityBps = event.params.diversityBps;
  snap.blockNumber = event.block.number;
  snap.txHash = event.transaction.hash;
  snap.save();
}
