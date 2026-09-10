import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatUnits, parseUnits, type Hex } from "viem";
import {
  ADDR, MAKER, ERC20_ABI, ROUTER_ABI, pc, loadStrategies, liveQuote, liveBook, takerData,
  simulateQuote, utilisationBps, widenFor, U32_MAX, type DeskStrategy, type QuoteResult,
} from "./deskchain";
import { short } from "./data";

/**
 * The quote desk: pull real quotes out of the deployed router with no wallet, and
 * drag the maker's wallet level to watch the same books widen and then refuse.
 * LIVE numbers are eth_calls against Base Sepolia; the drag column is the same
 * formulas the contracts run, computed client-side and labeled as simulation.
 */

const fmtWeth = (v: bigint) => Number(formatUnits(v, 18)).toLocaleString("en-US", { maximumFractionDigits: 5 });
const px = (usdcIn: bigint, out: bigint) =>
  out === 0n ? "…" : (Number(formatUnits(usdcIn, 6)) / Number(formatUnits(out, 18))).toLocaleString("en-US", { maximumFractionDigits: 2 });

function utilLabel(u: number) { return u === U32_MAX ? "∞" : `${(u / 100).toFixed(1)}%`; }

// ── the vessel: drag the liquid, drain the wallet ───────────────────────────
function Vessel({ committed, live, value, onChange }: {
  committed: bigint; live: bigint; value: bigint; onChange: (b: bigint) => void;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const H = 340, W = 190, top = 30, bot = H - 30;
  // scale so the healthy live level, the promise, and the floor all fit with air
  const floorBacking = (committed * 10_000n) / 9_500n;
  const cap = (bigMax(live, bigMax(committed, floorBacking)) * 23n) / 20n;
  const yFor = (b: bigint) => bot - Number((b > cap ? cap : b) * BigInt(bot - top)) / Number(cap);
  const bFor = (y: number) => {
    const t = Math.min(Math.max((bot - y) / (bot - top), 0), 1);
    return BigInt(Math.round(t * Number(cap)));
  };
  const yLiquid = yFor(value);
  const yPromise = yFor(committed);
  const yFloor = yFor(floorBacking);
  const u = utilisationBps(committed, value);

  const drag = useCallback((e: React.PointerEvent) => {
    if (e.buttons !== 1 || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    onChange(bFor(((e.clientY - r.top) / r.height) * H));
  }, [onChange]);

  return (
    <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="vessel"
      onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); drag(e); }}
      onPointerMove={drag} role="slider" aria-label="wallet backing"
      aria-valuenow={Number(formatUnits(value, 18))}>
      <rect x="34" y={top - 8} width={W - 68} height={bot - top + 16} rx="12"
        fill="var(--ink-800)" stroke="var(--rule-lit)" strokeWidth="1.5" />
      {/* liquid */}
      <rect x="37" y={yLiquid} width={W - 74} height={Math.max(bot + 8 - yLiquid, 0)} rx="8" fill="var(--delivered-dim)" />
      <rect x="37" y={yLiquid} width={W - 74} height="2.5" fill="var(--delivered)" />
      {/* floor: refuse below this level */}
      <line x1="16" x2={W - 16} y1={yFloor} y2={yFloor} stroke="var(--returned)" strokeWidth="1.3" />
      <text x={W - 16} y={yFloor - 7} textAnchor="end" className="v-label red">floor · refuse below</text>
      {/* the promise */}
      <line x1="16" x2={W - 16} y1={yPromise} y2={yPromise} stroke="var(--claimed)" strokeDasharray="5 4" strokeWidth="1.2" />
      <text x="16" y={yPromise + 14} className="v-label">promised</text>
      {/* live marker */}
      <path d={`M 18 ${yFor(live)} l 9 -5.5 v 11 z`} fill="var(--link)" />
      {/* drag handle */}
      <circle cx={W / 2} cy={yLiquid} r="9" fill="var(--ink-800)" stroke="var(--delivered)" strokeWidth="2.5" className="vessel-handle" />
    </svg>
  );
}
const bigMax = (a: bigint, b: bigint) => (a > b ? a : b);

// ── wallet: the optional "take it" path ─────────────────────────────────────
type Eip1193 = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };
declare global { interface Window { ethereum?: Eip1193 } }

function useTaker(strategy: DeskStrategy | null, usdcIn: bigint, onDone: () => void) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");
  const [tx, setTx] = useState<string | null>(null);

  const take = async () => {
    if (!window.ethereum || !strategy) return;
    setState("busy"); setTx(null);
    try {
      const eth = window.ethereum;
      const [from] = await eth.request({ method: "eth_requestAccounts" }) as string[];
      try {
        await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x14a34" }] });
      } catch {
        await eth.request({ method: "wallet_addEthereumChain", params: [{
          chainId: "0x14a34", chainName: "Base Sepolia",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: ["https://sepolia.base.org"], blockExplorerUrls: ["https://sepolia.basescan.org"],
        }] });
      }
      const send = async (to: Hex, data: Hex, label: string) => {
        setMsg(label);
        const h = await eth.request({ method: "eth_sendTransaction", params: [{ from, to, data }] }) as Hex;
        await pc.waitForTransactionReceipt({ hash: h });
        return h;
      };
      const { encodeFunctionData } = await import("viem");
      const bal = await pc.readContract({ address: ADDR.usdc, abi: ERC20_ABI, functionName: "balanceOf", args: [from as Hex] });
      if (bal < usdcIn)
        await send(ADDR.usdc, encodeFunctionData({ abi: ERC20_ABI, functionName: "mint", args: [from as Hex, usdcIn] }), "minting demo USDC (open faucet)…");
      const alw = await pc.readContract({ address: ADDR.usdc, abi: ERC20_ABI, functionName: "allowance", args: [from as Hex, ADDR.router] });
      if (alw < usdcIn)
        await send(ADDR.usdc, encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [ADDR.router, usdcIn] }), "approving the router…");
      const td = await takerData(from as Hex);
      const h = await send(ADDR.router,
        encodeFunctionData({ abi: ROUTER_ABI, functionName: "swap", args: [strategy.order, usdcIn, td] as never }),
        "swapping…");
      setTx(h); setState("done"); setMsg("filled - WETH pulled straight from the maker's wallet"); onDone();
    } catch (e) {
      setState("error"); setMsg((e as Error).message?.slice(0, 90) ?? "failed");
    }
  };
  return { take, state, msg, tx, available: typeof window !== "undefined" && !!window.ethereum };
}

// ── the desk ────────────────────────────────────────────────────────────────
export function Desk() {
  const [strategies, setStrategies] = useState<DeskStrategy[]>([]);
  const [sel, setSel] = useState(0);
  const [amount, setAmount] = useState("500");
  const [book, setBook] = useState<{ committed: bigint; backing: bigint } | null>(null);
  const [dragged, setDragged] = useState<bigint | null>(null);
  const [live, setLive] = useState<QuoteResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const usdcIn = useMemo(() => {
    try { return parseUnits((amount || "0").replace(/[^0-9.]/g, ""), 6); } catch { return 0n; }
  }, [amount]);
  const strategy = strategies[sel] ?? null;

  const refresh = useCallback(async () => {
    try {
      const [ss, b] = await Promise.all([loadStrategies(), liveBook()]);
      setStrategies(ss); setBook(b); setErr(null);
    } catch (e) { setErr((e as Error).message); }
  }, []);
  useEffect(() => { refresh(); const h = setInterval(refresh, 20_000); return () => clearInterval(h); }, [refresh]);

  useEffect(() => {
    let alive = true;
    if (!strategy || usdcIn === 0n) { setLive(null); return; }
    liveQuote(strategy, usdcIn).then((q) => alive && setLive(q)).catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [strategy, usdcIn, book]);

  const [scene, setScene] = useState<number | null>(0);
  const backingForUtil = (utilBps: bigint) => book ? (book.committed * 10_000n) / utilBps : 0n;
  const pickScene = (i: number) => {
    setScene(i);
    if (!book) return;
    if (i === 0) setDragged(null);
    if (i === 1) setDragged(backingForUtil(8_700n));
    if (i === 2) setDragged(backingForUtil(9_900n));
  };
  const backing = dragged ?? book?.backing ?? 0n;
  const sim = strategy && book && usdcIn > 0n ? simulateQuote(strategy, usdcIn, backing, book.committed) : null;
  const simUtil = book ? utilisationBps(book.committed, backing) : 0;
  const taker = useTaker(strategy, usdcIn, refresh);

  if (err) return <div className="err">Base Sepolia unreachable - {err}</div>;
  if (!book || strategies.length === 0) return <div className="empty" style={{ padding: 80 }}>Reading the desk…{strategies.length === 0 && book ? " no active vignette strategies - run pnpm vignette" : ""}</div>;

  return (
    <>
    <div className="mainnet-intro">
      <h2>Drain the wallet. Watch the book say no.</h2>
      <p>
        The setup: one maker wallet on Base Sepolia backs three quoting strategies at
        once, exactly how real Aqua makers run. The wallet's balance sheet flows into
        every quote:
      </p>
      <div className="flowline num">
        <span>maker wallet</span><i>→</i><span>The Graph index</span><i>→</i><span>on-chain oracle</span><i>→</i><span>every quote</span>
      </div>
      <p>Step through what happens as that wallet drains, or drag it yourself:</p>
    </div>
    <section className="desk">
      <div className="desk-side">
        <div className="label" style={{ marginBottom: 8 }}>The maker's wallet</div>
        <Vessel committed={book.committed} live={book.backing} value={backing} onChange={(b) => { setScene(null); setDragged(b); }} />
        <div className="vessel-readout">
          <b className={simUtil >= 9_500 ? "bad" : ""}>{utilLabel(simUtil)}</b>
          <span className="label">utilised · {fmtWeth(backing)} WETH</span>
        </div>
        <div className="desk-legend">
          <span><i className="sw live" /> live level {fmtWeth(book.backing)} WETH</span>
          {dragged !== null && <button className="linkish" onClick={() => setDragged(null)}>reset to live</button>}
        </div>
        <p className="note">
          One wallet backs all three books. Nothing on Aqua stops it draining; the books
          read the oracle at quote time and defend themselves.
        </p>
      </div>

      <div className="desk-main">
        <div className="scenes">
          {["1 · Healthy", "2 · The wallet drains", "3 · Past the floor"].map((t, i) => (
            <button key={t} className={scene === i ? "on" : ""} onClick={() => pickScene(i)}>{t}</button>
          ))}
        </div>
        <p className="scene-cap">
          {scene === 0 && `The wallet holds ${fmtWeth(book.backing)} WETH against ${fmtWeth(book.committed)} WETH promised across the three books. Plenty of backing, so the router quotes the normal price.`}
          {scene === 1 && "The maker moves inventory elsewhere. Aqua itself would not notice - the quote would stay frozen at the stale price. Solvent's oracle sees the thinner wallet, and the same book widens its own spread: compare the two quotes below."}
          {scene === 2 && "Past the 95% floor the book stops quoting entirely, with a reason. A taker or aggregator sees the refusal for free, instead of paying gas to discover an empty wallet."}
          {scene === null && "Sandbox: you set the wallet level. LIVE is the router's real answer at the current on-chain level; the right cell recomputes the quote at your hypothetical level with the contract's own formulas."}
        </p>
        <div className="ticket">
          <div className="ticket-row strat-row">
            {strategies.map((s, i) => (
              <button key={s.hash} className={`chip${i === sel ? " on" : ""}`} onClick={() => setSel(i)}>
                <b>strategy {s.key}</b>
                <span>fee {(s.feeBps1e7 / 1e5).toFixed(2)}% · widens from {(s.skewStartBps / 100).toFixed(0)}%</span>
              </button>
            ))}
          </div>

          <div className="ticket-row">
            <span className="label">Sell</span>
            <input className="amt" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
            <span className="unit">USDC</span>
            <span className="label" style={{ marginLeft: "auto" }}>for WETH · maker {short(MAKER)}</span>
          </div>

          <div className="quote-grid">
            <div className={`qcell${live && !live.ok ? " declined" : ""}`}>
              <span className="label">Live quote · from the router, right now</span>
              {!live ? <b className="q">…</b> : live.ok ? (
                <>
                  <b className="q">{fmtWeth(live.amountOut)} WETH</b>
                  <span className="qsub">{px(usdcIn, live.amountOut)} USDC/WETH · book {utilLabel(utilisationBps(book.committed, book.backing))} utilised</span>
                </>
              ) : (
                <>
                  <b className="q stamp-decline">DECLINED</b>
                  <span className="qsub">SolvencyFloor: {utilLabel(live.utilisationBps)} &gt; {utilLabel(live.maxUtilisationBps)} - refused at quote time, no gas wasted</span>
                </>
              )}
            </div>
            <div className={`qcell sim${dragged !== null && sim && !sim.ok ? " declined" : ""}`}>
              <span className="label">{dragged === null ? "What if the wallet drained" : `At ${fmtWeth(backing)} WETH · same formulas, simulated`}</span>
              {dragged === null ? (
                <span className="qsub" style={{ margin: "auto 0" }}>drag the wallet level on the left - the quote recomputes with the contract's own formulas</span>
              ) : !sim ? <b className="q">…</b> : sim.ok ? (
                <>
                  <b className="q">{fmtWeth(sim.amountOut)} WETH</b>
                  <span className="qsub">
                    {px(usdcIn, sim.amountOut)} USDC/WETH
                    {strategy && simUtil > strategy.skewStartBps && ` · skew +${(widenFor(simUtil, strategy.skewStartBps, strategy.skewMaxWiden) / 1e5).toFixed(2)}%`}
                  </span>
                </>
              ) : (
                <>
                  <b className="q stamp-decline">DECLINED</b>
                  <span className="qsub">SolvencyFloor: {utilLabel(sim.utilisationBps)} &gt; {utilLabel(sim.maxUtilisationBps)}</span>
                </>
              )}
            </div>
          </div>

          <div className="ticket-row take-row">
            {taker.available ? (
              <button className="take" disabled={taker.state === "busy" || !live?.ok} onClick={taker.take}>
                {taker.state === "busy" ? "working…" : "Take this quote"}
              </button>
            ) : (
              <span className="note">With a browser wallet and a little Base Sepolia ETH you can take this quote for real; the demo USDC faucet is open.</span>
            )}
            {taker.msg && <span className={`note${taker.state === "error" ? " warn" : ""}`}>{taker.msg}</span>}
            {taker.tx && <a href={`https://sepolia.basescan.org/tx/${taker.tx}`} target="_blank" rel="noreferrer">view fill ↗</a>}
          </div>
        </div>

        <p className="cost note" style={{ marginTop: 18 }}>
          Everything in the LIVE column is an eth_call against the deployed router; the
          decline is the real MakerBeyondSolvencyFloor revert, decoded. The simulation
          runs the identical formulas client-side so you can preview any wallet level
          without waiting for the attestor.
        </p>
      </div>
    </section>
    </>
  );
}
