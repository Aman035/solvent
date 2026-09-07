import { useEffect, useMemo, useState } from "react";
import { fetchBooks, nameOf, short, SUBGRAPH_URL, SUBGRAPH_URL_BASE, type BooksSnapshot, type MakerBook } from "./data";
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
  const committed = Number(b.committed) / 10 ** meta.decimals;
  const backing = Number(b.backing) / 10 ** meta.decimals;
  const track = Math.max(committed, backing, 1e-12);
  const covered = Math.min(committed, backing) / track;
  const phantom = committed > backing ? (committed - backing) / track : 0;
  const spare = backing > committed ? (backing - committed) / track : 0;
  const u = Number(b.utilisationBps);
  const pastFloor = floorBps !== null && u >= floorBps;

  return (
    <div className="book">
      <a className="book-maker" href={`${explorer}/address/${b.maker}`} target="_blank" rel="noreferrer">
        {nameOf(b.maker)}
      </a>
      <span className="book-token">{meta.symbol}</span>
      <div className="book-bar" title={`promised ${fmt(b.committed, meta.decimals)} · wallet can settle ${fmt(b.backing, meta.decimals)}`}>
        <i className="seg covered" style={{ width: `${covered * 100}%` }} />
        {phantom > 0 && <i className="seg phantom" style={{ width: `${phantom * 100}%` }} />}
        {spare > 0 && <i className="seg spare" style={{ width: `${spare * 100}%` }} />}
      </div>
      <span className="num book-amt">{fmt(b.committed, meta.decimals)}<span className="dim"> promised</span></span>
      <span className="num book-amt">{fmt(b.backing, meta.decimals)}<span className="dim"> backed</span></span>
      <span className={`num book-util${u > 10_000 ? " over" : ""}${pastFloor ? " floored" : ""}`}>
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
      <span className="label">Promise vs wallet</span>
      <span className="label" style={{ textAlign: "right" }}>Promised</span>
      <span className="label" style={{ textAlign: "right" }}>Backed</span>
      <span className="label" style={{ textAlign: "right" }}>Utilisation</span>
    </div>
  );
}

export function MainnetBooks() {
  const { snap, err } = useBooks(SUBGRAPH_URL_BASE, 30_000);
  const books = useMemo(() => (snap?.books ?? []).filter(nonEmpty), [snap]);
  const over = books.filter((b) => Number(b.utilisationBps) > 10_000);
  const makers = new Set(books.map((b) => b.maker)).size;
  const worst = [...books].sort(byUtilThenSize).slice(0, 25);

  return (
    <section className="books">
      {err && <div className="err">Base subgraph unreachable - {err}</div>}
      <div className="books-head">
        <div className="hed">
          1inch Aqua on Base, right now
          <span className="sub">real makers, real books, indexed live at block {snap ? snap.head.toLocaleString() : "…"}</span>
        </div>
        {snap && (
          <div className="books-stats">
            <span className="stat"><span className="label">Makers</span><b>{makers}</b></span>
            <span className="stat"><span className="label">Books</span><b>{books.length}</b></span>
            <span className="stat"><span className="label">Quoting more than they hold</span>
              <b style={{ color: over.length ? "var(--returned)" : undefined }}>{over.length}</b></span>
          </div>
        )}
      </div>
      <BookHeader />
      {worst.map((b) => (
        <BookRow key={b.maker + b.token} b={b} explorer="https://basescan.org" floorBps={null} />
      ))}
      <p className="cost note" style={{ marginTop: 22, maxWidth: 760 }}>
        Nothing here is a demo. These are live Aqua strategies on Base mainnet, their promised
        virtual balances read from ship calldata and rawBalances, their backing read from the
        maker's actual wallet at every touch. Red is liquidity that is advertised and cannot
        settle - the gap Solvent's instructions price at quote time.
      </p>
    </section>
  );
}
