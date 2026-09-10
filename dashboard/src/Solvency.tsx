import { useEffect, useMemo, useState } from "react";
import { fetchBooks, nameOf, short, SUBGRAPH_URL, SUBGRAPH_URL_BASE, SUBGRAPH_URL_ARBITRUM, SUBGRAPH_URL_OPTIMISM, type BooksSnapshot, type MakerBook } from "./data";
import baseTokens from "./base-tokens.json";

/**
 * A maker's balance sheet, drawn to scale.
 *
 * The bar is the promise: solid green is the part the wallet can actually settle,
 * red is the part it cannot. Utilisation over 100% is not an error state - it is
 * the normal condition of Aqua market making, measured; the point of Solvent is
 * that quotes know it.
 */

const TOKENS: Record<string, { symbol: string; decimals: number }> = baseTokens as never;
// Sepolia mock tokens carry their own names
const SEPOLIA_TOKENS: Record<string, { symbol: string; decimals: number }> = {};
export function registerSepoliaTokens(map: Record<string, { symbol: string; decimals: number }>) {
  for (const [k, v] of Object.entries(map)) SEPOLIA_TOKENS[k.toLowerCase()] = v;
}

/** Canonical tokens on the other indexed chains (base-tokens.json covers Base). */
const EXTRA_TOKENS: Record<string, { symbol: string; decimals: number }> = {
  // Arbitrum One
  "0x82af49447d8a07e3bd95bd0d56f35241523fbab1": { symbol: "WETH", decimals: 18 },
  "0xaf88d065e77c8cc2239327c5edb3a432268e5831": { symbol: "USDC", decimals: 6 },
  "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9": { symbol: "USDT", decimals: 6 },
  "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1": { symbol: "DAI", decimals: 18 },
  "0x5979d7b546e38e414f7e9822514be443a4800529": { symbol: "wstETH", decimals: 18 },
  "0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f": { symbol: "WBTC", decimals: 8 },
  "0xf97f4df75117a78c1a5a0dbb814af92458539fb4": { symbol: "LINK", decimals: 18 },
  "0x912ce59144191c1204e64559fe8253a0e49e6548": { symbol: "ARB", decimals: 18 },
  // Optimism
  "0x4200000000000000000000000000000000000006": { symbol: "WETH", decimals: 18 },
  "0x4200000000000000000000000000000000000042": { symbol: "OP", decimals: 18 },
  "0x0b2c639c533813f4aa9d7837caf62653d097ff85": { symbol: "USDC", decimals: 6 },
  "0x94b008aa00579c1307b0ef2c499ad98a8ce58e58": { symbol: "USDT", decimals: 6 },
  "0x68f180fcce6836688e9084f035309e29bf0a2095": { symbol: "WBTC", decimals: 8 },
  "0x350a791bfc2c21f9ed5d10980dad2e2638ffa7f6": { symbol: "LINK", decimals: 18 },
  "0xda10009cbd5d07dd0cecc66161fc93d7c9000da2": { symbol: "DAI", decimals: 18 },
};

function tokenMeta(addr: string): { symbol: string; decimals: number } {
  const a = addr.toLowerCase();
  return TOKENS[a] ?? EXTRA_TOKENS[a] ?? SEPOLIA_TOKENS[a] ?? { symbol: short(addr), decimals: 18 };
}

function fmt(amount: string, decimals: number): string {
  const v = Number(amount) / 10 ** decimals;
  if (v === 0) return "0";
  if (v >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (v >= 1) return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return v.toLocaleString("en-US", { maximumFractionDigits: 5 });
}

function utilLabel(b: MakerBook): string {
  const u = Number(b.utilisationBps);
  if (u === 0xffffffff) return "∞";
  if (u >= 100_000) return `${Math.round(u / 100).toLocaleString("en-US")}%`;
  return `${(u / 100).toFixed(1)}%`;
}

function BookRow({ b, explorer, floorBps }: { b: MakerBook; explorer: string; floorBps: number | null }) {
  const meta = tokenMeta(b.token);
  const u = Number(b.utilisationBps);
  const inf = u === 0xffffffff;
  // the capsule is the promise; green is the part the wallet can actually settle
  const coverage = u === 0 ? 1 : inf ? 0 : Math.min(10_000 / u, 1);
  const over = u > 10_000;
  const pastFloor = floorBps !== null && u >= floorBps;

  return (
    <div className="book">
      <a className="book-maker" href={`${explorer}/address/${b.maker}`} target="_blank" rel="noreferrer">
        {nameOf(b.maker)}
      </a>
      <span className="book-token">{meta.symbol}</span>
      <div className={`cov${over ? " short" : ""}`}
        title={`promised ${fmt(b.committed, meta.decimals)} · wallet can settle ${fmt(b.backing, meta.decimals)}`}>
        <i style={{ width: `${Math.max(coverage * 100, coverage > 0 ? 1.5 : 0).toFixed(1)}%` }} />
      </div>
      <span className="num book-amt">{fmt(b.committed, meta.decimals)}</span>
      <span className="num book-amt">{fmt(b.backing, meta.decimals)}</span>
      <span className={`num book-util${over ? " over" : ""}${pastFloor ? " floored" : ""}`}>
        {utilLabel(b)}{pastFloor && <em> · past floor</em>}
      </span>
    </div>
  );
}

function useBooks(url: string, pollMs: number) {
  const [snap, setSnap] = useState<BooksSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);   // true while the CURRENT url has no fresh data yet
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    const tick = async () => {
      try {
        const s = await fetchBooks(url);
        if (alive) { setSnap(s); setErr(null); setLoading(false); setUpdatedAt(Date.now()); }
      } catch (e) { if (alive) { setErr((e as Error).message); setLoading(false); } }
    };
    tick();
    const h = setInterval(tick, pollMs);
    return () => { alive = false; clearInterval(h); };
  }, [url, pollMs]);
  return { snap, err, loading, updatedAt };
}

/** "just now" / "14s ago" - re-renders itself so the page visibly breathes. */
function Ago({ t }: { t: number | null }) {
  const [, force] = useState(0);
  useEffect(() => { const h = setInterval(() => force((n) => n + 1), 5_000); return () => clearInterval(h); }, []);
  if (!t) return null;
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  return <span className="ago"><i className="livedot" />{s < 8 ? "live · just now" : `live · ${s}s ago`}</span>;
}

const nonEmpty = (b: MakerBook) => b.committed !== "0" || b.backing !== "0";
const byUtilThenSize = (a: MakerBook, z: MakerBook) => {
  const d = Number(z.utilisationBps) - Number(a.utilisationBps);
  return d !== 0 ? d : Number(z.committed) - Number(a.committed);
};

export function SepoliaBooks() {
  const { snap, err, loading, updatedAt } = useBooks(SUBGRAPH_URL, 8_000);
  const books = useMemo(() => (snap?.books ?? []).filter(nonEmpty).sort(byUtilThenSize), [snap]);
  return (
    <section className="books">
      {err && <div className="err">Subgraph unreachable - {err}</div>}
      <div className="mainnet-intro">
        <h2>The balance sheet the quotes read.</h2>
        <p>
          Every maker on our Sepolia deployment, promised against what their wallet can
          settle. The attestor writes these sheets into the on-chain oracle, and the
          SolvencySkew and SolvencyFloor instructions read them inside every quote.
        </p>
      </div>
      <div className="books-head">
        <Ago t={updatedAt} />
      </div>
      {loading && <div className="loadbar" />}
      <div className={loading ? "table-dim" : undefined}>
        <BookHeader />
        {books.map((b) => (
          <BookRow key={b.maker + b.token} b={b} explorer="https://sepolia.basescan.org" floorBps={9_500} />
        ))}
      </div>
      {snap && books.length === 0 && <div className="empty" style={{ padding: 40 }}>No books yet - run pnpm vignette.</div>}
      <p className="cost note" style={{ marginTop: 22, maxWidth: 760 }}>
        These books drive quoting directly: the attestor writes each sheet into SolventBook,
        and every SolvencySkew and SolvencyFloor strategy reads it at quote time. Drain the
        wallet and the spreads widen on their own; pass the floor and the books refuse.
      </p>
    </section>
  );
}

function BookHeader() {
  return (
    <div className="book book-cols">
      <span className="label">Maker</span>
      <span className="label">Token</span>
      <span className="label">The promise, and how much is real</span>
      <span className="label" style={{ textAlign: "right" }}>Promised</span>
      <span className="label" style={{ textAlign: "right" }}>Can settle</span>
      <span className="label" style={{ textAlign: "right" }}>Utilisation</span>
    </div>
  );
}

export function MainnetBooks() {
  const CHAINS = [
    { key: "Base", url: SUBGRAPH_URL_BASE, explorer: "https://basescan.org" },
    { key: "Arbitrum", url: SUBGRAPH_URL_ARBITRUM, explorer: "https://arbiscan.io" },
    { key: "Optimism", url: SUBGRAPH_URL_OPTIMISM, explorer: "https://optimistic.etherscan.io" },
  ];
  const [ci, setCi] = useState(0);
  const chain = CHAINS[ci];
  const { snap, err, loading, updatedAt } = useBooks(chain.url, 15_000);
  const books = useMemo(() => (snap?.books ?? []).filter(nonEmpty), [snap]);
  const over = books.filter((b) => Number(b.utilisationBps) > 10_000);
  const makers = new Set(books.map((b) => b.maker)).size;
  const worst = [...books].sort(byUtilThenSize).slice(0, 20);

  return (
    <section className="books">
      <div className="mainnet-intro">
        <h2>Naked quoting, live.</h2>
        <p>
          Every row below is a real 1inch Aqua maker, right now. The capsule is what they
          advertise; the green is what their wallet can actually settle. Where it runs
          empty, takers are being quoted liquidity that does not exist, and the venue
          will keep quoting it until someone pays gas to find out.
        </p>
        <p className="mainnet-solves">
          Solvent's instruments decline exactly these books at quote time.
          <span className="status-chips">
            <span className="ro-badge">Live on Base Sepolia</span>
            <span className="soon">mainnet coming soon</span>
          </span>
        </p>
      </div>
      <div className="books-head">
        <nav className="chainswitch">
          {CHAINS.map((c, i) => (
            <button key={c.key} className={i === ci ? "on" : ""} onClick={() => setCi(i)}>{c.key}</button>
          ))}
        </nav>
        {snap && (
          <div className="books-stats">
            <span className="stat"><span className="label">Makers</span><b>{makers}</b></span>
            <span className="stat"><span className="label">Books</span><b>{books.length}</b></span>
            <span className="stat"><span className="label">Over-committed</span>
              <b style={{ color: over.length ? "var(--returned)" : undefined }}>{over.length}</b></span>
            <span className="stat"><span className="label">Indexed to</span><b>{snap.head.toLocaleString()}</b></span>
            <Ago t={updatedAt} />
          </div>
        )}
      </div>
      {loading && <div className="loadbar" />}
      {err && <div className="err">{chain.key} subgraph unreachable - {err}</div>}
      <div className={loading ? "table-dim" : undefined}>
        <BookHeader />
        {worst.map((b) => (
          <BookRow key={b.maker + b.token} b={b} explorer={chain.explorer} floorBps={null} />
        ))}
      </div>
    </section>
  );
}
