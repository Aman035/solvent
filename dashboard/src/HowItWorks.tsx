import manifest from "../../deployments/84532.json";
import { SUBGRAPH_URL } from "./data";

/**
 * The system, drawn honestly: every box is a real deployed thing with its address,
 * every arrow a real call or event. Two lanes - the continuous pipeline that keeps
 * the oracle honest, and the read path inside a single quote.
 */

const C = manifest.contracts as Record<string, { address: string }>;
const scan = (a: string) => `https://sepolia.basescan.org/address/${a}#code`;
const shortA = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

interface Node { name: string; role: string; addr?: string; href?: string; tag?: string }

function Lane({ title, sub, nodes }: { title: string; sub: string; nodes: Node[] }) {
  return (
    <div className="lane">
      <div className="lane-head">
        <b>{title}</b>
        <span>{sub}</span>
      </div>
      <div className="lane-flow">
        {nodes.map((n, i) => (
          <div key={n.name} className="lane-step">
            {i > 0 && <i className="lane-arrow">→</i>}
            <div className="arch-node">
              <b>{n.name}</b>
              <span className="arch-role">{n.role}</span>
              {n.addr && <a className="num arch-addr" href={scan(n.addr)} target="_blank" rel="noreferrer">{shortA(n.addr)} ↗</a>}
              {n.href && <a className="num arch-addr" href={n.href} target="_blank" rel="noreferrer">{n.tag} ↗</a>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function HowItWorks() {
  return (
    <section className="arch">
      <div className="mainnet-intro">
        <h2>What is actually deployed.</h2>
        <p>
          Every box below is live on Base Sepolia with its address linked; every arrow
          is a real call or event. Two loops make the product: a pipeline that keeps
          the oracle honest, and instructions that read it inside every quote.
        </p>
      </div>

      <Lane
        title="Keeping the oracle honest"
        sub="runs continuously · about once a minute"
        nodes={[
          { name: "Maker wallet", role: "holds the tokens; never deposits" },
          { name: "1inch Aqua", role: "records promises · ship / pull / push / dock", addr: C.aqua.address },
          { name: "The Graph index", role: "rebuilds each maker's book from events", href: `${SUBGRAPH_URL}/graphql`, tag: "playground" },
          { name: "Keeper", role: "re-reads every wallet, writes only changes", href: "https://github.com/Aman035/solvent/actions/workflows/attest.yml", tag: "public runs" },
          { name: "SolventBook", role: "the on-chain balance-sheet oracle", addr: C.solventBook.address },
        ]}
      />

      <Lane
        title="Inside every quote"
        sub="at call time · one eth_call, no trust needed"
        nodes={[
          { name: "Taker or aggregator", role: "asks the router for a price" },
          { name: "SolventRouter", role: "runs the strategy's SwapVM program", addr: C.router.address },
          { name: "SolvencyFloor + SolvencySkew", role: "read SolventBook: widen the spread, or refuse with a reason", addr: C.router.address },
          { name: "Settlement", role: "on swap, Aqua pulls tokens straight from the maker's wallet", addr: C.aqua.address },
        ]}
      />

      <div className="arch-side">
        <b>The settlement record</b>
        <p>
          A second, smaller layer keeps score of who actually delivered:
          {" "}<a className="num" href={scan(C.score.address)} target="_blank" rel="noreferrer">SolventScore</a> caches each
          counterparty's settlement score, <a className="num" href={scan(C.recorder.address)} target="_blank" rel="noreferrer">SolventRecorder</a>
          {" "}makes reverted fills indexable, and ERC-8004 registries hold identities. The ReputationGate
          instruction can refuse a taker with no track record - the same refuse-at-quote-time mechanic,
          pointed the other way.
        </p>
      </div>
    </section>
  );
}
