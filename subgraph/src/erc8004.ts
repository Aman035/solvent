import { BigInt } from "@graphprotocol/graph-ts";
import { Registered } from "../generated/IdentityRegistry/IdentityRegistry";
import { NewFeedback } from "../generated/ReputationRegistry/ReputationRegistry";
import { Agent, AgentIdLink, Review } from "../generated/schema";
import { loadAgent, BPS, ZERO } from "./shared";

export function handleRegistered(event: Registered): void {
  let agent = loadAgent(event.params.owner, event.block);
  agent.agentId = event.params.agentId;
  agent.agentURI = event.params.agentURI;
  agent.registeredAtBlock = event.block.number;
  agent.save();

  // agentId -> address, so review events (keyed by agentId) can reach the
  // delivery record (keyed by wallet). This link IS the claimed/delivered join.
  let link = new AgentIdLink(event.params.agentId.toString());
  link.agent = agent.id;
  link.save();
}

export function handleNewFeedback(event: NewFeedback): void {
  let link = AgentIdLink.load(event.params.agentId.toString());
  if (link == null) return;                       // review for an agent we never saw registered
  let agent = Agent.load(link.agent);
  if (agent == null) return;

  let r = new Review(event.transaction.hash.concatI32(event.logIndex.toI32()));
  r.agent = agent.id;
  r.reviewer = event.params.clientAddress;
  r.value = BigInt.fromI32(event.params.value.toI32());
  r.valueDecimals = event.params.valueDecimals;
  r.tag1 = event.params.tag1;
  r.blockNumber = event.block.number;
  r.timestamp = event.block.timestamp;
  r.txHash = event.transaction.hash;
  r.save();

  agent.reviewCount = agent.reviewCount + 1;
  agent.reviewSum = agent.reviewSum.plus(r.value);
  // average in basis points, so the UI can render 4.90 without float maths
  agent.reviewAvgBps = agent.reviewSum.times(BPS).div(BigInt.fromI32(agent.reviewCount)).toI32();
  agent.lastActiveBlock = event.block.number;
  agent.save();
}
