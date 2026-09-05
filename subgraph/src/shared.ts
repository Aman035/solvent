import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { Agent, Counterparty, Global } from "../generated/schema";

export const ZERO = BigInt.fromI32(0);
export const BPS = BigInt.fromI32(10000);
/** Failures weigh 3x in the reliability term. Mirrors ProofOfFillScore._FAILURE_WEIGHT. */
export const FAILURE_WEIGHT = BigInt.fromI32(3);

/**
 * Fixed USD prices for the demo tokens, 6dp. There is no testnet oracle, so this is a
 * documented constant rather than a pretend price feed - see docs/TRUST_ASSUMPTIONS.md.
 */
export function priceUsd6(token: Address): BigInt {
  const t = token.toHexString().toLowerCase();
  if (t == "0x097b80a3a5e9a82c65ef934c3ea402502cdea1af") return BigInt.fromI32(1000000);          // $1.00
  if (t == "0x3ac3f85cdbd1ce973cce3e67bc3cf75b79c525c7") return BigInt.fromString("2500000000");  // $2500.00
  return ZERO;
}

export function decimalsOf(token: Address): u8 {
  const t = token.toHexString().toLowerCase();
  if (t == "0x097b80a3a5e9a82c65ef934c3ea402502cdea1af") return 6;
  return 18;
}

/** Convert a raw token amount into USD with 6 decimals. */
export function toUsd6(token: Address, amount: BigInt): BigInt {
  const price = priceUsd6(token);
  if (price.equals(ZERO)) return ZERO;
  let scale = BigInt.fromI32(10).pow(decimalsOf(token));
  return amount.times(price).div(scale);
}

export function loadAgent(addr: Address, block: ethereum.Block): Agent {
  let id = addr as Bytes;
  let a = Agent.load(id);
  if (a == null) {
    a = new Agent(id);
    a.honoredCount = 0;
    a.failedCount = 0;
    a.honoredValueUsd6 = ZERO;
    a.distinctTakers = 0;
    a.diversityBps = 0;
    a.proofOfFillScore = ZERO;
    a.onChainScore = ZERO;
    a.reviewCount = 0;
    a.reviewSum = ZERO;
    a.reviewAvgBps = 0;
    a.firstSeenBlock = block.number;
  }
  a.lastActiveBlock = block.number;
  return a as Agent;
}

export function counterpartyId(maker: Address, taker: Address): Bytes {
  return Bytes.fromHexString(maker.toHexString() + taker.toHexString().slice(2)) as Bytes;
}

/**
 * Recompute the agent's Herfindahl-based diversity and Proof-of-Fill score.
 *
 *   HHI       = sum over counterparties of (share_i)^2
 *   diversity = 1 - HHI          (a single counterparty => 0 => score 0)
 *   score     = usdHonored * honored/(honored + 3*failed) * diversity
 *
 * A maker that only ever trades with itself scores ZERO, structurally.
 * Mirrors ProofOfFillScore.computeScore - see docs/SCORE_DESIGN.md.
 */
export function recomputeScore(agent: Agent, counterpartyIds: Bytes[]): void {
  let total = agent.honoredValueUsd6;
  if (total.equals(ZERO) || counterpartyIds.length == 0) {
    agent.diversityBps = 0;
    agent.proofOfFillScore = ZERO;
    return;
  }

  // HHI in basis points: sum((v_i / total * 10000)^2) / 10000
  let hhiBps = ZERO;
  for (let i = 0; i < counterpartyIds.length; i++) {
    let cp = Counterparty.load(counterpartyIds[i]);
    if (cp == null) continue;
    let shareBps = cp.valueUsd6.times(BPS).div(total);
    hhiBps = hhiBps.plus(shareBps.times(shareBps).div(BPS));
  }
  if (hhiBps.gt(BPS)) hhiBps = BPS;

  let diversityBps = BPS.minus(hhiBps);
  agent.diversityBps = diversityBps.toI32();

  let honored = BigInt.fromI32(agent.honoredCount);
  let failed = BigInt.fromI32(agent.failedCount);
  let denom = honored.plus(FAILURE_WEIGHT.times(failed));
  if (denom.equals(ZERO)) { agent.proofOfFillScore = ZERO; return; }

  let base = total.div(BigInt.fromI32(1000000));
  agent.proofOfFillScore = base.times(honored).times(diversityBps).div(denom.times(BPS));
}

export function loadGlobal(block: ethereum.Block): Global {
  let id = Bytes.fromI32(1);
  let g = Global.load(id);
  if (g == null) {
    g = new Global(id);
    g.totalFills = 0;
    g.totalHonored = 0;
    g.totalFailed = 0;
    g.totalValueUsd6 = ZERO;
  }
  g.lastBlock = block.number;
  return g as Global;
}
