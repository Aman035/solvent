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

function tokenMeta(addr: string): { symbol: string; decimals: number } {
  return TOKENS[addr.toLowerCase()] ?? SEPOLIA_TOKENS[addr.toLowerCase()] ?? { symbol: short(addr), decimals: 18 };
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

function useBooks(url: string, pollMs: number): { snap: BooksSnapshot | null; err: string | null } {
  const [snap, setSnap] = useState<BooksSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try { const s = await fetchBooks(url); if (alive) { setSnap(s); setErr(null); } }
      catch (e) { if (alive) setErr((e as Error).message); }
    };
    tick();
    const h = setInterval(tick, pollMs);
    return () => { alive = false; clearInterval(h); };
  }, [url, pollMs]);
  return { snap, err };
}

const nonEmpty = (b: MakerBook) => b.committed !== "0" || b.backing !== "0";
const byUtilThenSize = (a: MakerBook, z: MakerBook) => {
  const d = Number(z.utilisationBps) - Number(a.utilisationBps);
  return d !== 0 ? d : Number(z.committed) - Number(a.committed);
};

export function SepoliaBooks() {
  const { snap, err } = useBooks(SUBGRAPH_URL, 8_000);
  const books = useMemo(() => (snap?.books ?? []).filter(nonEmpty).sort(byUtilThenSize), [snap]);
  return (
    <section className="books">
      {err && <div className="err">Subgraph unreachable - {err}</div>}
      <div className="books-head">
        <div className="hed">Maker balance sheets<span className="sub">what each wallet promised vs what it can settle · live from the index</span></div>
      </div>
      <BookHeader />
      {books.map((b) => (
        <BookRow key={b.maker + b.token} b={b} explorer="https://sepolia.basescan.org" floorBps={9_500} />
      ))}
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
  const { snap, err } = useBooks(chain.url, 30_000);
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
          </div>
        )}
      </div>
      {err && <div className="err">{chain.key} subgraph unreachable - {err}</div>}
      <BookHeader />
      {worst.map((b) => (
        <BookRow key={b.maker + b.token} b={b} explorer={chain.explorer} floorBps={null} />
      ))}
    </section>
  );
}
