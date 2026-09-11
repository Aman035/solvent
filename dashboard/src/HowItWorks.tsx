import manifest from "../../deployments/84532.json";
import { INDEX_LINK, explorerLink, NETWORK_IDS } from "./data";

/**
 * The system as a numbered pipeline. Every node is a real deployed thing: contracts
 * link to verified source, services to their public logs. Type tags teach the
 * architecture at a glance; SolventBook is highlighted as the pivot both lanes share.
 */

const C = manifest.contracts as Record<string, { address: string }>;
const scan = (a: string) => `https://sepolia.basescan.org/address/${a}#code`;
const shortA = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

type Kind = "actor" | "onchain" | "service";
interface Node {
  name: string; role: string; kind: Kind;
  addr?: string; href?: string; tag?: string; pivot?: boolean;
}

const KIND_LABEL: Record<Kind, string> = { actor: "actor", onchain: "on-chain", service: "service" };

function Lane({ title, sub, nodes, narrow }: { title: string; sub: string; nodes: Node[]; narrow?: boolean }) {
  return (
    <div className="lane">
      <div className="lane-head"><b>{title}</b><span>{sub}</span></div>
      <div className={`lane-grid${narrow ? " narrow" : ""}`} style={{ "--cols": nodes.length } as never}>
        {nodes.map((n, i) => (
          <div key={n.name} className={`gnode row-in${n.pivot ? " pivot" : ""}${i < nodes.length - 1 ? " haslink" : ""}`}
            style={{ "--i": i } as never}>
            <div className="gnode-top">
              <span className="gnum num">{String(i + 1).padStart(2, "0")}</span>
              <span className={`gtag ${n.kind}`}>{KIND_LABEL[n.kind]}</span>
            </div>
            <b>{n.name}</b>
            <span className="gnode-role">{n.role}</span>
            {n.addr && <a className="num gnode-addr" href={scan(n.addr)} target="_blank" rel="noreferrer">{shortA(n.addr)} ↗</a>}
            {n.href && <a className="num gnode-addr" href={n.href} target="_blank" rel="noreferrer">{n.tag} ↗</a>}
          </div>
        ))}
      </div>
    </div>
  );
}

export function HowItWorks() {
  return (
    <section className="arch">
      <div className="arch-head">
        <div className="mainnet-intro">
          <h2>What is actually deployed.</h2>
          <p>
            Solvent is two loops around one oracle. A continuous pipeline maintains a
            live balance sheet for every maker; a pair of SwapVM instructions read that
            sheet inside every quote. Nothing here is a diagram of intent: each
            component links to its verified source or its public logs.
          </p>
        </div>
        <aside className="legend">
          <span className="label">Reading the map</span>
          <div className="legend-row"><span className="gtag onchain">on-chain</span><span>a deployed contract, source verified on Basescan</span></div>
          <div className="legend-row"><span className="gtag service">service</span><span>off-chain infrastructure with public, auditable logs</span></div>
          <div className="legend-row"><span className="gtag actor">actor</span><span>any wallet; no permission or registration required</span></div>
          <div className="legend-row"><i className="legend-pivot" /><span>green border marks the shared oracle, written by one loop and read by the other</span></div>
        </aside>
      </div>

      <Lane
        title="Maintaining the oracle"
        sub="continuous · roughly once a minute"
        nodes={[
          { name: "Maker wallet", role: "holds all inventory; nothing is ever deposited", kind: "actor" },
          { name: "1inch Aqua", role: "registers each strategy's promised balances", kind: "onchain", addr: C.aqua.address },
          { name: "The Graph index", role: "reconstructs every maker's book from primary events", kind: "service", href: INDEX_LINK, tag: "on graph explorer" },
          { name: "Keeper", role: "verifies each wallet against the chain, writes only the differences", kind: "service", href: "https://github.com/Aman035/solvent/actions/workflows/attest.yml", tag: "run history" },
          { name: "SolventBook", role: "the balance-sheet oracle: promised and settleable, per maker, per token", kind: "onchain", addr: C.solventBook.address, pivot: true },
        ]}
      />

      <div className="published-row">
        <span className="label">Published on The Graph Network</span>
        {([["Base Sepolia", NETWORK_IDS.sepolia], ["Base", NETWORK_IDS.base],
           ["Arbitrum", NETWORK_IDS.arbitrum], ["Optimism", NETWORK_IDS.optimism]] as const).map(([name, id]) => (
          <a key={id} className="published-chip" href={explorerLink(id)} target="_blank" rel="noreferrer">{name} ↗</a>
        ))}
      </div>

      <Lane
        title="Serving the quote"
        sub="per call · a single eth_call, trustless"
        nodes={[
          { name: "Taker", role: "requests a price; an EOA, a bot, or an aggregator route", kind: "actor" },
          { name: "SolventRouter", role: "executes the strategy's SwapVM program instruction by instruction", kind: "onchain", addr: C.router.address },
          { name: "SolvencyFloor + Skew", role: "consult the oracle mid-program: widen the spread, or decline with a stated reason", kind: "onchain", addr: C.router.address, pivot: true },
          { name: "Settlement", role: "on execution, Aqua pulls tokens directly from the maker's wallet", kind: "onchain", addr: C.aqua.address },
        ]}
      />

      <div className="arch-foot">
        <span className="label">Failure mode</span>
        <p>
          The system fails closed. If the pipeline stalls anywhere, protected books read
          a stale sheet and err toward refusal: <b>the worst outcome is a declined
          quote, never a phantom fill.</b>
        </p>
      </div>
    </section>
  );
}
