import { useEffect, useRef, useState } from "react";
import { SUBGRAPH_URL_BASE, SUBGRAPH_URL_ARBITRUM, SUBGRAPH_URL_OPTIMISM } from "./data";
import baseTokens from "./base-tokens.json";

/**
 * Landing. The grammar borrowed from the best product-landing work: a giant
 * two-tone claim, one FUNCTIONAL widget card in the hero (a live quote, pulled
 * from the deployed router while you look at it), and the product's own
 * artifacts floating around the type like objects on a chart table.
 */

const TOKENS: Record<string, { symbol: string; decimals: number }> = baseTokens as never;

/** Adds .in when the element scrolls into view - drives the reveal transitions. */
function Reveal({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } },
      { threshold: 0.15, rootMargin: "0px 0px -10% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`reveal${seen ? " in" : ""} ${className}`} style={{ "--rd": `${delay}s` } as never}>
      {children}
    </div>
  );
}

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

interface Worst { maker: string; token: string; committed: bigint; utilBps: number; chain: string }

export function Landing({ onExplore }: { onExplore: (net: "testnet" | "mainnet") => void }) {
  const [stats, setStats] = useState({ makers: 59, over: 49 });
  const [worst, setWorst] = useState<Worst | null>(null);
  const [quote, setQuote] = useState<{ out: string; px: string; util: string } | null>(null);

  useEffect(() => {
    let alive = true;
    // all three mainnet indexes, aggregated
    const CHAINS = [
      { name: "Base", url: SUBGRAPH_URL_BASE },
      { name: "Arbitrum", url: SUBGRAPH_URL_ARBITRUM },
      { name: "Optimism", url: SUBGRAPH_URL_OPTIMISM },
    ];
    Promise.allSettled(CHAINS.map(async (c) => {
      const r = await fetch(c.url, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: `{ makerBooks(first: 1000, where: { committed_gt: "0" }) { maker token committed utilisationBps } }` }),
      });
      const j = await r.json();
      return { chain: c.name, books: (j.data?.makerBooks ?? []) as { maker: string; token: string; committed: string; utilisationBps: string }[] };
    })).then((results) => {
      if (!alive) return;
      const ok = results.filter((r): r is PromiseFulfilledResult<{ chain: string; books: { maker: string; token: string; committed: string; utilisationBps: string }[] }> => r.status === "fulfilled").map((r) => r.value);
      if (ok.length === 0) return;
      const makers = new Set(ok.flatMap((c) => c.books.map((b) => `${c.chain}:${b.maker}`))).size;
      const over = ok.reduce((n, c) => n + c.books.filter((b) => Number(b.utilisationBps) > 10_000).length, 0);
      setStats({ makers, over });
      const finite = ok.flatMap((c) => c.books
        .filter((b) => Number(b.utilisationBps) < 0xffffffff && Number(b.utilisationBps) > 10_000)
        .map((b) => ({ ...b, chain: c.chain })))
        .sort((a, b) => Number(b.utilisationBps) - Number(a.utilisationBps));
      const w = finite[0];
      if (w) setWorst({ maker: w.maker, token: w.token, committed: BigInt(w.committed), utilBps: Number(w.utilisationBps), chain: w.chain });
    });
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
      <div className="hero-wrap">
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
              <span className="hl" style={{ "--hd": "0s" } as never}>Never quote</span><br />
              <span className="hl" style={{ "--hd": "0.09s" } as never}>more than you</span><br />
              <em className="hl" style={{ "--hd": "0.18s" } as never}>can settle.</em>
            </h1>
            <p className="hero-sub2 rise" style={{ "--hd": "0.34s" } as never}>
              Solvent gives every 1inch Aqua position a live balance sheet: spreads that
              widen as the wallet thins, a floor where books refuse, and an index of every
              maker's true backing on three chains.
            </p>
            <div className="cta-row rise" style={{ "--hd": "0.46s" } as never}>
              <button className="cta" onClick={() => onExplore("testnet")}>Explore testnet</button>
              <button className="cta ghost" onClick={() => onExplore("mainnet")}>Explore mainnet</button>
            </div>
          </div>

          {/* the functional widget: a real quote, pulled while you look at it */}
          <aside className="widget float" style={{ "--rot": "0deg", "--pd": "0.5s", "--d": "1.3s" } as never}>
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
        <div className="float f-note" style={{ "--rot": "-4deg", "--pd": "0.66s", "--d": "1.5s" } as never}>
          <span className="label">SolvencySkew</span>
          <b className="num">+0.96%</b>
          <span>spread widened itself · book 87% utilised · no keeper, no dock</span>
        </div>

        <div className="float f-tile" style={{ "--rot": "5deg", "--pd": "0.58s", "--d": "1.4s" } as never}>
          <VesselTile />
        </div>

        <div className="float f-stamp" style={{ "--rot": "-7deg", "--pd": "0.82s", "--d": "1.7s" } as never}>
          <b>DECLINED</b>
          <span className="num">SolvencyFloor · 99.0% &gt; 95%</span>
        </div>

        <span className="hero-ticker label fade" style={{ "--hd": "0.9s" } as never}>
          indexed live on Base, Arbitrum and Optimism · {stats.makers} makers with open books · <em>{stats.over} quoting more than they hold</em>
        </span>

        {worst && wMeta && (
          <div className="float f-worst" style={{ "--rot": "3deg", "--pd": "0.74s", "--d": "1.6s" } as never}>
            <span className="label">indexed live on {worst.chain} mainnet</span>
            <b className="num">{Math.round(worst.utilBps / 100).toLocaleString("en-US")}%</b>
            <span className="num f-worst-sub">
              {worst.maker.slice(0, 6)}…{worst.maker.slice(-4)} promises {fmtAmt(worst.committed, wMeta.decimals)} {wMeta.symbol} it does not hold
            </span>
          </div>
        )}
        <button className="scroll-cue" aria-label="scroll to the problem"
          onClick={() => document.getElementById("problem")?.scrollIntoView({ behavior: "smooth" })}>↓</button>
      </main>
      </div>

      {/* ── the problem: one book, poster scale ── */}
      <section className="story problem" id="problem">
        <Reveal className="story-copy">
          <span className="label">The problem</span>
          <h2>One wallet, many promises, and nothing checking.</h2>
          <p>
            Aqua makers quote without depositing: strategies promise virtual balances
            while the tokens stay in the wallet. The wallet drains, the quotes stand
            still. We rebuilt every maker's balance sheet from Aqua's full history on
            three chains, and one real book looks like this:
          </p>
        </Reveal>

        <Reveal className="monument" delay={0.12}>
          <div className="mon-row top">
            <span><span className="label">advertised</span><b className="num">$51,161 USDC</b></span>
            <span className="mon-ghost num">0x7553…4a55 · Base mainnet</span>
          </div>
          <div className="mon-capsule" role="img" aria-label="a book advertising 51,161 dollars while holding zero" />
          <div className="mon-row bottom">
            <span><span className="label">held</span><b className="num red">$0</b></span>
            <span className="mon-note num">continuously, for weeks · every taker who tried it got a revert</span>
          </div>
        </Reveal>

        <Reveal className="evidence-strip num" delay={0.22}>
          <span>123 of 138 material books ran under-backed</span>
          <span>worst WETH book · $162,754 at 9.8% held</span>
          <span><i className="livedot" />{stats.over} over-committed right now, live</span>
        </Reveal>

        <div className="causes three">
          <Reveal className="cause" delay={0}>
            <i className="num">01</i>
            <span><b>Nothing sums the promises.</b> One wallet quietly backs many strategies at once.</span>
          </Reveal>
          <Reveal className="cause" delay={0.1}>
            <i className="num">02</i>
            <span><b>Quotes never read the wallet.</b> Prices stand still while the backing walks away.</span>
          </Reveal>
          <Reveal className="cause" delay={0.2}>
            <i className="num">03</i>
            <span><b>The remedy is manual.</b> The prescribed fix is a maker watching, and docking by hand.</span>
          </Reveal>
        </div>
      </section>

      {/* ── what solvent solves: one book, four moments ── */}
      <section className="story">
        <Reveal className="story-copy">
          <span className="label">What Solvent solves</span>
          <h2>Watch one book defend itself.</h2>
          <p>
            Solvent keeps a live balance sheet for every maker and puts it inside the
            quote. Below is the same strategy as its wallet drains: the spread widens on
            its own, and past the floor the book refuses, before any gas is spent.
          </p>
        </Reveal>
        <div className="bento">
          {[
            { u: "45%", fill: 0.62, bid: "3,106.67", note: "healthy · base fee only" },
            { u: "87%", fill: 0.16, bid: "3,202.86", note: "SolvencySkew widened the spread" },
            { u: "94%", fill: 0.08, bid: "3,220.02", note: "climbing toward the floor" },
          ].map((t, i) => (
            <Reveal key={t.u} className="tstep" delay={i * 0.09}>
              <div className="tstep-head">
                <span className="num tstep-u">{t.u} <small>utilised</small></span>
                <svg width="16" height="24" viewBox="0 0 16 24" aria-hidden="true">
                  <rect x="1" y="1" width="14" height="22" rx="4" fill="none" stroke="var(--rule-lit)" strokeWidth="1.5" />
                  <rect x="3" y={3 + 18 * (1 - t.fill)} width="10" height={18 * t.fill} rx="2" fill="var(--delivered)" />
                </svg>
              </div>
              <b className="num tstep-bid">{t.bid}</b>
              <span className="tstep-note">{t.note}</span>
            </Reveal>
          ))}
          <Reveal className="tstep declined big" delay={0.27}>
            <div className="tstep-head">
              <span className="num tstep-u">99% <small>utilised</small></span>
              <svg width="16" height="24" viewBox="0 0 16 24" aria-hidden="true">
                <rect x="1" y="1" width="14" height="22" rx="4" fill="none" stroke="var(--rule-lit)" strokeWidth="1.5" />
                <rect x="3" y="20.6" width="10" height="0.4" rx="0.2" fill="var(--returned)" />
              </svg>
            </div>
            <b className="num tstep-bid red">DECLINED</b>
            <span className="tstep-sub num">MakerBeyondSolvencyFloor · 99.0% &gt; 95%</span>
            <span className="tstep-note">Past the floor the book refuses at quote time, with a reason. No stale price, no wasted gas, no revert in a taker's face.</span>
          </Reveal>
          <Reveal className="tstep index" delay={0.36}>
            <span className="label">Behind every quote</span>
            <b>The index</b>
            <span className="tstep-note">One subgraph schema maintaining every maker's promise against their wallet, from primary events. The instruments read it on-chain.</span>
            <span className="chain-chips num">
              <em>Base</em><em>Arbitrum</em><em>Optimism</em>
            </span>
          </Reveal>
        </div>
        <div className="story-cta">
          <button className="cta" onClick={() => onExplore("testnet")}>Explore testnet</button>
          <button className="cta ghost" onClick={() => onExplore("mainnet")}>Explore mainnet</button>
        </div>
      </section>
    </div>
  );
}
