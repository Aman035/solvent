import { useEffect, useState } from "react";
import { SUBGRAPH_URL_BASE } from "./data";
import baseTokens from "./base-tokens.json";

/**
 * Landing. Left: the claim, set large. Right: the strongest evidence we own - the
 * worst real Aqua book on Base mainnet, drawn as a vessel, right now.
 */

const TOKENS: Record<string, { symbol: string; decimals: number }> = baseTokens as never;

interface Worst { maker: string; token: string; committed: bigint; backing: bigint; utilBps: number }
interface LiveStats { makers: number; over: number; head: number; worst: Worst | null }

function fmtAmt(v: bigint, dec: number) {
  const n = Number(v) / 10 ** dec;
  return n >= 1000 ? n.toLocaleString("en-US", { maximumFractionDigits: 0 })
    : n.toLocaleString("en-US", { maximumFractionDigits: n >= 1 ? 2 : 5 });
}

/** Static vessel: the promise line vs what the wallet can actually settle. */
function WorstVessel({ w }: { w: Worst }) {
  const H = 232, W = 170, top = 24, bot = H - 20;
  const cap = Number(w.committed) * 1.12;
  const y = (v: number) => bot - (Math.min(v, cap) / cap) * (bot - top);
  const yPromise = y(Number(w.committed));
  const yLiquid = y(Number(w.backing));
  const meta = TOKENS[w.token.toLowerCase()] ?? { symbol: w.token.slice(0, 8), decimals: 18 };
  const util = w.utilBps >= 0xffffffff ? "∞" : `${Math.round(w.utilBps / 100).toLocaleString("en-US")}%`;
  return (
    <figure className="worst">
      <svg viewBox={`0 0 ${W} ${H}`}>
        <rect x="26" y={top - 6} width={W - 52} height={bot - top + 12} rx="12"
          fill="var(--ink-800)" stroke="var(--rule-lit)" strokeWidth="1.5" />
        {yLiquid < bot + 4 && Number(w.backing) > 0 && (
          <>
            <rect x="29" y={yLiquid} width={W - 58} height={bot + 4 - yLiquid} rx="8" fill="var(--delivered-dim)" />
            <rect x="29" y={yLiquid} width={W - 58} height="2.5" fill="var(--delivered)" />
          </>
        )}
        {Number(w.backing) === 0 && <rect x="29" y={bot} width={W - 58} height="4" rx="2" fill="var(--delivered-dim)" />}
        <line x1="12" x2={W - 12} y1={yPromise} y2={yPromise} stroke="var(--returned)" strokeWidth="1.4" strokeDasharray="6 4" />
        <text x={W - 12} y={yPromise - 7} textAnchor="end" className="v-label red">what it quotes</text>
        <text x="29" y={(Number(w.backing) === 0 ? bot : yLiquid) - 7} className="v-label green">what it holds</text>
      </svg>
      <figcaption>
        <b className="worst-util">{util}</b>
        <span className="label">utilised · live on Base</span>
        <span className="worst-line">
          {w.maker.slice(0, 6)}…{w.maker.slice(-4)} promises {fmtAmt(w.committed, meta.decimals)} {meta.symbol},
          holds {fmtAmt(w.backing, meta.decimals)}
        </span>
      </figcaption>
    </figure>
  );
}

export function Landing({ onExplore }: { onExplore: (net: "testnet" | "mainnet") => void }) {
  const [s, setS] = useState<LiveStats | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(SUBGRAPH_URL_BASE, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: `{
        _meta { block { number } }
        makerBooks(first: 1000, where: { committed_gt: "0" }) { maker token committed backing utilisationBps }
      }` }),
    }).then((r) => r.json()).then((j) => {
      if (!alive || !j.data) return;
      const books = j.data.makerBooks as { maker: string; token: string; committed: string; backing: string; utilisationBps: string }[];
      const over = books.filter((b) => Number(b.utilisationBps) > 10_000);
      const finite = books.filter((b) => Number(b.utilisationBps) < 0xffffffff && Number(b.utilisationBps) > 10_000);
      const w = finite.sort((a, b) => Number(b.utilisationBps) - Number(a.utilisationBps))[0];
      setS({
        makers: new Set(books.map((b) => b.maker)).size, over: over.length,
        head: j.data._meta.block.number,
        worst: w ? { maker: w.maker, token: w.token, committed: BigInt(w.committed), backing: BigInt(w.backing), utilBps: Number(w.utilisationBps) } : null,
      });
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  return (
    <div className="landing">
      <header className="landing-top">
        <img src={`${import.meta.env.BASE_URL}wordmark.svg`} alt="Solvent" height="26" />
        <a className="gh" href="https://github.com/Aman035/solvent" target="_blank" rel="noreferrer">GitHub ↗</a>
      </header>

      <main className="hero2">
        <div className="hero2-left">
          <h1>Market making that never quotes more than it can settle.</h1>
          <p>
            On 1inch Aqua, makers keep custody and every quote can be naked. Solvent gives
            each position a live balance sheet: spreads that widen as the wallet thins, a
            floor below which books refuse at quote time, and an index of every maker's
            true backing on three chains.
          </p>

          <nav className="doors2">
            <button onClick={() => onExplore("testnet")}>
              <span className="door2-name">Explore testnet</span>
              <span className="door2-desc">the working machine on Base Sepolia: pull real quotes, drain the wallet, watch the books defend themselves</span>
            </button>
            <button onClick={() => onExplore("mainnet")}>
              <span className="door2-name">Explore mainnet</span>
              <span className="door2-desc">every real Aqua maker's balance sheet, indexed live on Base, Arbitrum and Optimism · contracts coming soon</span>
            </button>
          </nav>

          {s && (
            <div className="ticker label">
              live on Base: {s.makers} makers with open books · <em>{s.over} quoting more than they hold</em>
            </div>
          )}
        </div>

        <div className="hero2-right">
          {s?.worst && <WorstVessel w={s.worst} />}
        </div>
      </main>
    </div>
  );
}
