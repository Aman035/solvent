import { agentFills, type AgentRow, type FillRow, reliabilityBps } from "@solvent/core";

/**
 * Risk analysis over LIVE Graph data.
 *
 * Every flag below is derived from indexed on-chain behaviour, and several are only
 * computable BECAUSE both sides are indexed: REVIEW_DELIVERY_DIVERGENCE needs the
 * ERC-8004 review record joined to the Aqua fill record. Remove The Graph and this
 * analysis cannot be produced at all.
 */

export type FlagCode =
  | "NO_TRACK_RECORD"
  | "REVIEW_DELIVERY_DIVERGENCE"
  | "COUNTERPARTY_CONCENTRATION"
  | "TEMPORAL_CLUSTERING"
  | "RECENT_FAILURES"
  | "UNREVIEWED_BUT_DELIVERING";

export interface Flag { code: FlagCode; severity: "high" | "medium" | "low"; detail: string }

export interface Assessment {
  agent: `0x${string}`;
  score: bigint;
  honoredUsd: number;
  flags: Flag[];
  reliabilityBps: number;
  verdict: "trust" | "caution" | "avoid";
  rationale: string;
  llmUsed: boolean;
}

/** Deterministic analysis. Always runs; the LLM only narrates on top of this. */
export async function assess(a: AgentRow): Promise<Assessment> {
  const flags: Flag[] = [];
  const honoredUsd = Number(a.honoredValueUsd6) / 1e6;
  const score = BigInt(a.settlementScore);
  const stars = a.reviewAvgBps / 10000;

  if (a.honoredCount === 0) {
    flags.push({ code: "NO_TRACK_RECORD", severity: "high", detail: "has never honoured a fill" });
    if (a.reviewCount >= 5) {
      flags.push({
        code: "REVIEW_DELIVERY_DIVERGENCE", severity: "high",
        detail: `${a.reviewCount} reviews averaging ${stars.toFixed(2)}/5, but zero delivery`,
      });
    }
  } else {
    if (a.reviewCount === 0) {
      flags.push({ code: "UNREVIEWED_BUT_DELIVERING", severity: "low", detail: `no reviews, but ${a.honoredCount} honoured fills` });
    }
    if (a.distinctTakers <= 2) {
      flags.push({
        code: "COUNTERPARTY_CONCENTRATION", severity: a.distinctTakers <= 1 ? "high" : "medium",
        detail: `only ${a.distinctTakers} distinct counterpart${a.distinctTakers === 1 ? "y" : "ies"} — volume may be self-dealt`,
      });
    }
    if (a.failedCount > 0) {
      flags.push({
        code: "RECENT_FAILURES", severity: a.failedCount >= a.honoredCount ? "high" : "medium",
        detail: `${a.failedCount} failed fill${a.failedCount === 1 ? "" : "s"} against ${a.honoredCount} honoured`,
      });
    }
    // temporal clustering: a manufactured history tends to land in one narrow window
    try {
      const fills: FillRow[] = await agentFills(a.id, 100);
      if (fills.length >= 4) {
        const blocks = fills.map((f) => Number(f.blockNumber));
        const span = Math.max(...blocks) - Math.min(...blocks);
        if (span < 30) {
          flags.push({ code: "TEMPORAL_CLUSTERING", severity: "medium", detail: `all ${fills.length} fills within ${span} blocks` });
        }
      }
    } catch { /* history unavailable; deterministic flags above still stand */ }
  }

  const high = flags.filter((f) => f.severity === "high").length;
  const verdict: Assessment["verdict"] =
    a.honoredCount === 0 || high > 0 ? "avoid" : flags.length > 0 ? "caution" : "trust";

  const rationale =
    a.honoredCount === 0
      ? `No delivery record. ${a.reviewCount > 0 ? `The ${a.reviewCount} reviews (★${stars.toFixed(2)}) are unbacked by any fill.` : "No reviews either."}`
      : `$${honoredUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })} honoured across ${a.honoredCount} fills with ${a.distinctTakers} counterparties${a.failedCount ? `, but ${a.failedCount} failures` : " and no failures"}.`;

  return {
    agent: a.id, score, honoredUsd, flags,
    reliabilityBps: reliabilityBps(a.honoredCount, a.failedCount),
    verdict, rationale, llmUsed: false,
  };
}

/**
 * DETERMINISTIC SAFETY RAIL.
 *
 * Never select a maker with no delivery record while one with a record exists - and
 * never select one the analysis says to avoid if any alternative is acceptable. The
 * rail is what guarantees the demo; the LLM reasons INSIDE it and cannot override it.
 */
export function selectCounterparty(assessments: Assessment[]): { chosen: Assessment | null; rejected: Assessment[] } {
  const viable = assessments.filter((a) => a.honoredUsd > 0 && a.verdict !== "avoid");
  const pool = viable.length > 0 ? viable : [];
  if (pool.length === 0) return { chosen: null, rejected: assessments };
  const chosen = pool.reduce((best, a) => (a.score > best.score ? a : best), pool[0]);
  return { chosen, rejected: assessments.filter((a) => a.agent !== chosen.agent) };
}
