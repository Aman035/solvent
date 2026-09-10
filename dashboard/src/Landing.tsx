import { useEffect, useState } from "react";
import { SUBGRAPH_URL_BASE } from "./data";
import baseTokens from "./base-tokens.json";

/**
 * Landing. The grammar borrowed from the best product-landing work: a giant
 * two-tone claim, one FUNCTIONAL widget card in the hero (a live quote, pulled
 * from the deployed router while you look at it), and the product's own
 * artifacts floating around the type like objects on a chart table.
 */

const TOKENS: Record<string, { symbol: string; decimals: number }> = baseTokens as never;

function fmtAmt(v: bigint, dec: number) {
  const n = Number(v) / 10 ** dec;
  return n >= 1000 ? n.toLocaleString("en-US", { maximumFractionDigits: 0 })
    : n.toLocaleString("en-US", { maximumFractionDigits: n >= 1 ? 2 : 5 });
}

function VesselTile({ size = 64 }: { size?: number }) {
  const r = size / 2, ring = size * 0.15, ringR = r - ring / 2, fillR = ringR - ring / 2 + 0.5;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <path d={`M ${r - fillR} ${r} A ${fillR} ${fillR} 0 0 0 ${r + fillR} ${r} Z`} fill="var(--delivered)" />
      <line x1={r - fillR + 3} y1={r} x2={r + fillR - 3} y2={r} stroke="#fff" strokeOpacity="0.55" strokeWidth={size * 0.04} strokeLinecap="round" />
      <circle cx={r} cy={r} r={ringR} fill="none" stroke="var(--text)" strokeWidth={ring} />
    </svg>
  );
}

interface Worst { maker: string; token: string; committed: bigint; utilBps: number }

export function Landing({ onExplore }: { onExplore: (net: "testnet" | "mainnet") => void }) {
  const [stats, setStats] = useState({ makers: 59, over: 49 });
  const [worst, setWorst] = useState<Worst | null>(null);
  const [quote, setQuote] = useState<{ out: string; px: string; util: string } | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(SUBGRAPH_URL_BASE, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: `{ makerBooks(first: 1000, where: { committed_gt: "0" }) { maker token committed utilisationBps } }` }),
    }).then((r) => r.json()).then((j) => {
      if (!alive || !j.data) return;
      const books = j.data.makerBooks as { maker: string; token: string; committed: string; utilisationBps: string }[];
      setStats({
        makers: new Set(books.map((b) => b.maker)).size,
        over: books.filter((b) => Number(b.utilisationBps) > 10_000).length,
      });
      const w = books.filter((b) => Number(b.utilisationBps) < 0xffffffff && Number(b.utilisationBps) > 10_000)
        .sort((a, b) => Number(b.utilisationBps) - Number(a.utilisationBps))[0];
      if (w) setWorst({ maker: w.maker, token: w.token, committed: BigInt(w.committed), utilBps: Number(w.utilisationBps) });
    }).catch(() => {});
    // a real quote for the widget card, while the visitor watches
    import("./deskchain").then(async ({ loadStrategies, liveQuote, liveBook, utilisationBps }) => {
      try {
        const [ss, book] = await Promise.all([loadStrategies(), liveBook()]);
        if (!ss.length) return;
        const q = await liveQuote(ss[0], 500_000_000n);
        if (!alive || !q.ok) return;
        const out = Number(q.amountOut) / 1e18;
        setQuote({
          out: out.toLocaleString("en-US", { maximumFractionDigits: 5 }),
          px: (500 / out).toLocaleString("en-US", { maximumFractionDigits: 2 }),
          util: (utilisationBps(book.committed, book.backing) / 100).toFixed(1),
        });
      } catch { /* widget falls back to its skeleton */ }
    });
    return () => { alive = false; };
  }, []);

  const wMeta = worst ? (TOKENS[worst.token.toLowerCase()] ?? { symbol: "?", decimals: 18 }) : null;

  return (
    <div className="landing">
      <header className="landing-top">
        <img src={`${import.meta.env.BASE_URL}wordmark.svg`} alt="Solvent" height="24" />
        <nav className="landing-links">
          <a href="https://www.npmjs.com/package/@aqua-solvent/core" target="_blank" rel="noreferrer">SDK</a>
          <a href="https://github.com/Aman035/solvent" target="_blank" rel="noreferrer">GitHub ↗</a>
        </nav>
      </header>

      <main className="hero-panel">
        <div className="hero-grid">
          <div className="hero-copy">
            <h1>
              <span>Never quote</span><br />
              <span>more than you</span><br />
              <em>can settle.</em>
            </h1>
            <p className="hero-sub2">
              Solvent gives every 1inch Aqua position a live balance sheet: spreads that
              widen as the wallet thins, a floor where books refuse, and an index of every
              maker's true backing on three chains.
            </p>
            <div className="cta-row">
              <button className="cta" onClick={() => onExplore("testnet")}>Explore testnet</button>
              <button className="cta ghost" onClick={() => onExplore("mainnet")}>Explore mainnet</button>
            </div>
          </div>

          {/* the functional widget: a real quote, pulled while you look at it */}
          <aside className="widget float" style={{ "--rot": "0deg", "--d": "0.4s" } as never}>
            <div className="widget-head">
              <span>Strategy A<br /><small>USDC → WETH · Base Sepolia</small></span>
              <i className="livedot" />
            </div>
            <div className="widget-quote">
              <span className="label">Sell 500 USDC · live from the router</span>
              {quote ? (
                <>
                  <b className="num">{quote.out} WETH</b>
                  <span className="num widget-px">{quote.px} USDC/WETH</span>
                </>
              ) : (
                <>
                  <b className="num skeleton">0.·····</b>
                  <span className="num widget-px">quoting…</span>
                </>
              )}
            </div>
            <div className="widget-rows num">
              <span><span>Book utilisation</span><span>{quote ? `${quote.util}%` : "…"}</span></span>
              <span><span>Widens from</span><span>50%</span></span>
              <span><span>Refuses at</span><span className="red">95%</span></span>
            </div>
            <button className="widget-cta" onClick={() => onExplore("testnet")}>Open the quote desk</button>
          </aside>
        </div>

        {/* ── artifacts on the chart table ── */}
        <div className="float f-note" style={{ "--rot": "-4deg", "--d": "1.4s" } as never}>
          <i className="pin" />
          <span>the whitepaper's remedy: "makers are strongly recommended to manually dock strategies"</span>
        </div>

        <div className="float f-tile" style={{ "--rot": "5deg", "--d": "0.8s" } as never}>
          <VesselTile />
        </div>

        <div className="float f-stamp" style={{ "--rot": "-7deg", "--d": "2s" } as never}>
          <b>DECLINED</b>
          <span className="num">SolvencyFloor · 99.0% &gt; 95%</span>
        </div>

        <span className="hero-ticker label">
          live on Base · {stats.makers} makers with open books · <em>{stats.over} quoting more than they hold</em>
        </span>

        {worst && wMeta && (
          <div className="float f-worst" style={{ "--rot": "3deg", "--d": "1s" } as never}>
            <span className="label">live on Base mainnet</span>
            <b className="num">{Math.round(worst.utilBps / 100).toLocaleString("en-US")}%</b>
            <span className="num f-worst-sub">
              {worst.maker.slice(0, 6)}…{worst.maker.slice(-4)} promises {fmtAmt(worst.committed, wMeta.decimals)} {wMeta.symbol} it does not hold
            </span>
          </div>
        )}
      </main>
    </div>
  );
}
