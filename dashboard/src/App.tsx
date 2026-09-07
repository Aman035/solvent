import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchSnapshot, registerNames, nameOf, usd, stars, short, txUrl, addrUrl, ago,
  STUDIO, SUBGRAPH_URL, decodeProgram, type Snapshot, type Agent, type Fill,
} from "./data";
import costWash from "../../docs/cost-to-fake.json";
import costRev from "../../docs/cost-to-fake-reviews.json";
import manifest from "../../deployments/84532.json";
import { SepoliaBooks, MainnetBooks, registerSepoliaTokens } from "./Solvency";

registerNames({
  [manifest.contracts["agentId.alice"]?.address ?? ""]: "Alice",
  [manifest.contracts["agentId.bob"]?.address ?? ""]: "Bob",
  [manifest.contracts["agentId.mallory"]?.address ?? ""]: "Mallory",
  [costWash.attacker]: "Wash trader",
  "0xcf66abc4e23809135f349c36625b5bf41af0df01": "Solvent maker",
});
registerSepoliaTokens({
  [manifest.contracts.weth.address]: { symbol: "WETH", decimals: 18 },
  [manifest.contracts.usdc.address]: { symbol: "USDC", decimals: 6 },
});

type Tab = "books" | "mainnet" | "ledger";
const TABS: { id: Tab; name: string; tag: string }[] = [
  { id: "books", name: "Balance sheets", tag: "Base Sepolia · quotes read these" },
  { id: "mainnet", name: "Mainnet", tag: "1inch Aqua on Base · live" },
  { id: "ledger", name: "Settlement ledger", tag: "claimed vs delivered" },
];

const POLL_MS = 6000;

/** Concentration is the measurable tell of manufactured volume: a maker trading with
 *  very few counterparties has, by construction, a low Herfindahl diversity. */
const CONCENTRATED = 70_00;

function Stamp({ a }: { a: Agent }) {
  if (a.honoredCount === 0) return <div className="stamp norecord">No record</div>;
  if (a.failedCount > 0) return <div className="stamp partial">{a.failedCount} returned</div>;
  if (a.distinctTakers < 4 || a.diversityBps < CONCENTRATED) return <div className="stamp concentrated">Concentrated</div>;
  return <div className="stamp cleared">Cleared</div>;
}

/**
 * The signature element.
 *
 * CLAIMED renders as uniform hairline ticks — one per review — because that is exactly
 * what a review is: free, interchangeable, identical to every other. DELIVERED renders
 * as solid segments of real varying magnitude, one per fill. The argument is carried by
 * the texture: a rank of identical ghosts above a channel that is either full or empty.
 */
function Tape({ agent, maxUsd }: { agent: Agent; maxUsd: number }) {
  const delivered = Number(agent.honoredValueUsd6) / 1e6;
  const segments = useMemo(
    () => agent.counterparties.map((c) => Number(c.valueUsd6) / 1e6).sort((x, y) => y - x),
    [agent.counterparties],
  );
  const thin = agent.diversityBps < 7000;

  return (
    <div className="tape">
      <div className="tape-line">
        <span className="label tape-key">Claimed</span>
        {agent.reviewCount > 0 ? (
          <>
            <div className="ticks track-ticks" title={`${agent.reviewCount} reviews, every one rated ${stars(agent.reviewAvgBps)}/5`}>
              {Array.from({ length: Math.min(agent.reviewCount, 40) }, (_, i) => (
                <i className="tick" key={i} />
              ))}
            </div>
            <span className="spread">{stars(agent.reviewAvgBps)}/5 · every one identical</span>
          </>
        ) : (
          <div className="ticks empty-note">no reviews</div>
        )}
      </div>

      <div className="tape-line">
        <span className="label tape-key">Delivered</span>
        {delivered > 0 ? (
          <>
            <div className="track" title={`$${usd(agent.honoredValueUsd6)} across ${agent.distinctTakers} counterparties`}>
              {segments.map((v, i) => (
                <span className="seg" key={i} style={{ width: `${Math.max(1.2, (v / maxUsd) * 100)}%` }} />
              ))}
            </div>
            <span className="spread">
              {agent.distinctTakers} {agent.distinctTakers === 1 ? "party" : "parties"} ·{" "}
              <span className={thin ? "thin" : undefined}>{(agent.diversityBps / 100).toFixed(0)}% spread</span>
            </span>
          </>
        ) : (
          <div className="channel">nothing delivered</div>
        )}
      </div>
    </div>
  );
}

function Row({ a, maxUsd, onOpen }: { a: Agent; maxUsd: number; onOpen: () => void }) {
  const delivered = Number(a.honoredValueUsd6) / 1e6;
  return (
    <div className="row" onClick={onOpen} tabIndex={0} role="button"
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}>
      <div className="who">
        <div className="nm">{nameOf(a.id)}</div>
        <div className="meta">
          {a.agentId ? `agent #${a.agentId}` : "unregistered"} · {short(a.id, 3)}
        </div>
      </div>
      <Tape agent={a} maxUsd={maxUsd} />
      <div className="figs">
        <div className={`big${delivered === 0 ? " zero" : ""}`}>${usd(a.honoredValueUsd6, 0)}</div>
        <div className="sub">
          {a.honoredCount} cleared{a.failedCount > 0 && <span className="bad"> · {a.failedCount} returned</span>}
        </div>
        <div className="score">score <b>{Number(a.proofOfFillScore).toLocaleString()}</b></div>
      </div>
      <Stamp a={a} />
    </div>
  );
}

function Drawer({ a, onClose }: { a: Agent; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const strat = a.strategies[0];
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={`${nameOf(a.id)} statement`}>
        <header>
          <div>
            <h2>{nameOf(a.id)}</h2>
            <div className="label" style={{ marginTop: 4 }}>
              {a.agentId ? `ERC-8004 agent #${a.agentId}` : "not registered"}
            </div>
          </div>
          <button className="close" onClick={onClose} aria-label="Close">esc</button>
        </header>

        <section>
          <div className="label">Claimed — ERC-8004 reputation</div>
          <div className="kv">
            <div>Average rating</div><div>★ {stars(a.reviewAvgBps)}</div>
            <div>Reviewers</div><div>{a.reviewCount}</div>
            <div>Cost to obtain</div><div>${(costRev.mainnetEquivalentUsdPerReview * a.reviewCount).toFixed(2)}</div>
          </div>
          {a.reviews.length > 0 && (
            <>
              <div className="label" style={{ marginTop: 14 }}>Every reviewer — click to verify</div>
              <div className="revgrid">
                {a.reviews.map((r) => (
                  <a key={r.id} href={txUrl(r.txHash)} target="_blank" rel="noreferrer" title={`${short(r.reviewer)} · ★${r.value}`} />
                ))}
              </div>
            </>
          )}
        </section>

        <section>
          <div className="label">Delivered — settled on Aqua</div>
          <div className="kv">
            <div>Value honoured</div><div style={{ color: "var(--delivered)" }}>${usd(a.honoredValueUsd6)}</div>
            <div>Fills cleared</div><div>{a.honoredCount}</div>
            <div>Fills returned</div><div style={{ color: a.failedCount ? "var(--returned)" : undefined }}>{a.failedCount}</div>
            <div>Distinct counterparties</div><div>{a.distinctTakers}</div>
            <div>Counterparty diversity</div><div>{(a.diversityBps / 100).toFixed(2)}%</div>
            <div>Proof-of-Fill score</div><div>{a.proofOfFillScore}</div>
            <div>On-chain score</div><div>{a.onChainScore}</div>
          </div>
        </section>

        {strat && (
          <section>
            <div className="label">Live strategy on Aqua</div>
            <div className="chips">
              {decodeProgram(strat.program).map((ix, i) => (
                <span className={`chip${ix.ours ? " ours" : ""}`} key={i}>
                  {ix.name} 0x{ix.opcode.toString(16).padStart(2, "0")}
                </span>
              ))}
            </div>
            <p className="cost note" style={{ marginTop: 10 }}>
              Highlighted instructions are custom SwapVM opcodes added by this project,
              running on a redeployed router. Everything else is stock 1inch.
            </p>
            <p className="cost note" style={{ marginTop: 12 }}>
              Inventory was never deposited. It stays in the wallet until a taker pulls it —
              which is why a maker who moves it away produces a public failure.
            </p>
            <div style={{ marginTop: 10 }}>
              <a href={txUrl(strat.shippedTx)} target="_blank" rel="noreferrer">Shipping transaction ↗</a>
            </div>
          </section>
        )}

        <section>
          <a href={addrUrl(a.id)} target="_blank" rel="noreferrer">View wallet on BaseScan ↗</a>
        </section>
      </aside>
    </>
  );
}

function Fills({ fills, seen }: { fills: Fill[]; seen: Set<string> }) {
  if (fills.length === 0) return <div className="empty">No settlement activity yet.</div>;
  return (
    <>
      {fills.map((f) => (
        <div key={f.id} className={`fill ${f.status === "HONORED" ? "honored" : "failed"}${seen.has(f.id) ? "" : " new"}`}>
          <span className="t">{ago(f.timestamp)}</span>
          <span>
            {nameOf(f.maker.id)} <span style={{ color: "var(--text-3)" }}>→</span> {nameOf(f.taker.id)}
          </span>
          <span className="amt">
            {f.status === "HONORED" ? `$${usd(f.valueUsd6, 0)}` : "—"}
          </span>
          <a className="badge" href={txUrl(f.status === "FAILED" && f.failedTxHash ? f.failedTxHash : f.txHash)}
            target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
            {f.status === "HONORED" ? "CLEARED ↗" : "RETURNED ↗"}
          </a>
        </div>
      ))}
    </>
  );
}

export default function App() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const s = await fetchSnapshot();
        if (!alive) return;
        setSnap((prev) => { if (prev) prev.fills.forEach((f) => seen.current.add(f.id)); return s; });
        setErr(null);
      } catch (e) { if (alive) setErr((e as Error).message); }
    };
    tick();
    const h = setInterval(tick, POLL_MS);
    return () => { alive = false; clearInterval(h); };
  }, []);

  const maxUsd = useMemo(
    () => Math.max(1, ...(snap?.agents ?? []).map((a) => Number(a.honoredValueUsd6) / 1e6)),
    [snap],
  );
  const lag = snap ? snap.chainHead - snap.head : 0;
  const opened = snap?.agents.find((a) => a.id === open) ?? null;

  const [tab, setTab] = useState<Tab>("books");

  return (
    <div className="shell">
      <div className="rail">
        <span className="mark">Solvent</span>
        <span className="tag">{TABS.find((t) => t.id === tab)!.tag}</span>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>{t.name}</button>
          ))}
        </nav>
        <span className="spacer" />
        {tab === "ledger" && snap && (
          <>
            <span className="stat"><span className="label">Cleared</span><b>{snap.global?.totalHonored ?? 0}</b></span>
            <span className="stat"><span className="label">Returned</span>
              <b style={{ color: (snap.global?.totalFailed ?? 0) > 0 ? "var(--returned)" : undefined }}>{snap.global?.totalFailed ?? 0}</b></span>
            <span className="stat"><span className="label">Block</span><b>{snap.head.toLocaleString()}</b></span>
            <span className="stat">
              <span className={`pulse${lag > 50 || snap.indexingErrors ? " stale" : ""}`} />
              <b>{lag <= 50 ? `${lag} behind` : `${lag} behind — stale`}</b>
            </span>
          </>
        )}
        <a href={STUDIO} target="_blank" rel="noreferrer">The Graph ↗</a>
      </div>

      {tab === "books" && <SepoliaBooks />}
      {tab === "mainnet" && <MainnetBooks />}

      {tab === "ledger" && err && <div className="err">Subgraph unreachable — {err}. Check SUBGRAPH_URL in .env, then reload.</div>}
      {tab === "ledger" && !snap && !err && <div className="empty" style={{ padding: 80 }}>Reading the ledger…</div>}

      {tab === "ledger" && snap && (
        <>
          <div className="statement-head">
            <div className="hed">Agent<span className="sub">ERC-8004 identity</span></div>
            <div className="hed">Claimed against delivered<span className="sub">reviews are free · fills cost inventory</span></div>
            <div className="hed" style={{ textAlign: "right" }}>Value honoured<span className="sub">settled, in USD</span></div>
            <div className="hed" style={{ textAlign: "center" }}>Standing<span className="sub">&nbsp;</span></div>
          </div>

          {snap.agents.map((a) => (
            <Row key={a.id} a={a} maxUsd={maxUsd} onOpen={() => setOpen(a.id)} />
          ))}

          <div className="deck">
            <div className="panel">
              <header>
                <span className="label">Settlement feed</span>
                <span className="spacer" />
                <span className="label">newest first</span>
              </header>
              <div className="body"><Fills fills={snap.fills} seen={seen.current} /></div>
            </div>

            <div className="panel">
              <header><span className="label">What a reputation costs</span><span className="spacer" />
                <span className="label">measured on-chain</span></header>
              <div className="cost">
                <table>
                  <tbody>
                    <tr><td>Perfect ★5.00 from {costRev.reviewers} reviewers</td><td className="warn">${(costRev.mainnetEquivalentUsdPerReview * costRev.reviewers).toFixed(2)}</td></tr>
                    <tr><td>…capital required</td><td className="warn">$0</td></tr>
                    <tr><td>${costWash.volumeFakedUsd.toLocaleString()} of delivered value</td><td>${costWash.gasMainnetEquivalentUsd} gas</td></tr>
                    <tr><td>…capital required</td><td className="hi">${costWash.capitalRequiredUsd.toLocaleString()}</td></tr>
                    <tr><td>Same volume, one counterparty</td><td className="hi">score {costWash.scoreWithOnePuppet}</td></tr>
                  </tbody>
                </table>
                <p className="note">
                  Gas is not the defence — faking fills is cheaper in gas than faking reviews.
                  Capital is. Reviews are free speech; fills are collateralised speech.
                  A maker that only trades with itself scores zero however much volume it writes.
                </p>
              </div>
            </div>
          </div>

          <p className="cost note" style={{ marginTop: 26, maxWidth: 760 }}>
            Every figure is read live from a Graph subgraph indexing ERC-8004 reputation
            alongside 1inch Aqua settlement. <a href={SUBGRAPH_URL} target="_blank" rel="noreferrer">Query it directly ↗</a>
          </p>
        </>
      )}

      {opened && <Drawer a={opened} onClose={() => setOpen(null)} />}
    </div>
  );
}
