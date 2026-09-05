/**
 * TypeScript port of ProofOfFillScore.computeScore.
 *
 * MUST stay bit-identical to the Solidity implementation - the dashboard, the attestor
 * and Bob all display or act on this number, and a divergence would mean the UI showing
 * a different score from the one the ReputationGate opcode enforces.
 * contracts/test/ScoreDifferential.t.sol pins the two together.
 *
 * Design and rationale: docs/SCORE_DESIGN.md
 */

export const BPS = 10_000n;
export const FAILURE_WEIGHT = 3n;
export const UINT32_MAX = 4_294_967_295n;

export interface ScoreParts {
  honoredValueUsd6: bigint;
  honoredCount: number;
  failedCount: number;
  diversityBps: number;
}

export function computeScore(s: ScoreParts): bigint {
  const honored = BigInt(s.honoredCount);
  const failed = BigInt(s.failedCount);
  const diversity = BigInt(s.diversityBps);

  const denom = honored + FAILURE_WEIGHT * failed;
  if (denom === 0n || s.honoredValueUsd6 === 0n || diversity === 0n) return 0n;

  const base = s.honoredValueUsd6 / 1_000_000n;
  const v = (base * honored * diversity) / (denom * BPS);
  return v > UINT32_MAX ? UINT32_MAX : v;
}

/**
 * Herfindahl-Hirschman concentration over an agent's counterparties, in basis points.
 * diversityBps = 10000 - HHI_bps. A single counterparty gives HHI = 1 -> diversity 0.
 * Integer arithmetic mirrors the subgraph mapping exactly.
 */
export function diversityBpsFrom(counterpartyValues: bigint[]): number {
  const total = counterpartyValues.reduce((a, b) => a + b, 0n);
  if (total === 0n || counterpartyValues.length === 0) return 0;
  let hhi = 0n;
  for (const v of counterpartyValues) {
    const shareBps = (v * BPS) / total;
    hhi += (shareBps * shareBps) / BPS;
  }
  if (hhi > BPS) hhi = BPS;
  return Number(BPS - hhi);
}

/** Reliability term on its own, for consumers that want a capital-independent signal. */
export function reliabilityBps(honoredCount: number, failedCount: number): number {
  const h = BigInt(honoredCount), f = BigInt(failedCount);
  const denom = h + FAILURE_WEIGHT * f;
  return denom === 0n ? 0 : Number((h * BPS) / denom);
}
