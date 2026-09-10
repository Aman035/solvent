import manifest from "../../deployments/84532.json";
import { SUBGRAPH_URL } from "./data";

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
      <div className="mainnet-intro">
        <h2>What is actually deployed.</h2>
        <p>
          Two loops make the product. A pipeline keeps a live balance sheet for every
          maker; two instructions read it inside every quote. Every box below is real:
          contracts link to verified source, services to their public logs.
        </p>
      </div>

      <Lane
        title="The pipeline · keeping the oracle honest"
        sub="continuous · about once a minute"
        nodes={[
          { name: "Maker wallet", role: "holds the tokens; never deposits", kind: "actor" },
          { name: "1inch Aqua", role: "records the promises · ship, pull, push, dock", kind: "onchain", addr: C.aqua.address },
          { name: "The Graph index", role: "rebuilds each maker's book from events", kind: "service", href: `${SUBGRAPH_URL}/graphql`, tag: "playground" },
          { name: "Keeper", role: "re-reads every wallet, writes only what changed", kind: "service", href: "https://github.com/Aman035/solvent/actions/workflows/attest.yml", tag: "public runs" },
          { name: "SolventBook", role: "the on-chain balance-sheet oracle", kind: "onchain", addr: C.solventBook.address, pivot: true },
        ]}
      />

      <Lane
        title="The quote · where the oracle bites"
        sub="at call time · one eth_call, no trust needed"
        narrow
        nodes={[
          { name: "Taker", role: "asks the router for a price", kind: "actor" },
          { name: "SolventRouter", role: "runs the strategy's SwapVM program", kind: "onchain", addr: C.router.address },
          { name: "Floor + Skew", role: "read SolventBook: widen the spread, or refuse with a reason", kind: "onchain", addr: C.router.address, pivot: true },
          { name: "Settlement", role: "Aqua pulls tokens straight from the maker's wallet", kind: "onchain", addr: C.aqua.address },
        ]}
      />

      <p className="arch-foot">
        The green nodes are the same contract: the oracle the pipeline maintains is the
        oracle every quote reads. Break the link anywhere and quotes simply refuse -
        the failure mode is a declined quote, never a phantom fill.
      </p>
    </section>
  );
}
