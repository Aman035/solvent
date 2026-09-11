import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatUnits, formatEther, type Hex } from "viem";
import {
  readClient, role, allWallets, targetFor, addrs, readManifest, activeChain,
  subgraphHead, gql, computeScore, env, REPO_ROOT, ERC20_ABI,
  account, buildOrder, buildTakerData, SWAP_ABI,
} from "@aqua-solvent/core";
import { type Check, pass, fail } from "./types.js";

const rd = () => readClient();
const sh = (cmd: string) => execSync(cmd, { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] }).toString();

const SCORE_ABI = [{ name: "scoreOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint32" }] }] as const;

export const checks: Check[] = [
  {
    id: "V9", name: "Toolchain", phase: "0 Verify",
    async run() {
      const ev: string[] = [];
      for (const [tool, cmd] of [["forge", "forge --version"], ["node", "node --version"], ["pnpm", "pnpm --version"], ["graph", "graph --version"]] as const) {
        try { ev.push(`${tool}: ${sh(cmd).split("\n")[0].trim()}`); }
        catch { return fail([...ev, `${tool}: MISSING`]); }
      }
      return pass(ev);
    },
  },
  {
    id: "C1", name: "Scaffold builds and tests green", phase: "1 Foundations",
    async run() {
      const out = sh("cd contracts && forge test 2>&1 | tail -2");
      const m = out.match(/(\d+) tests passed.*?(\d+) failed/s) ?? out.match(/(\d+) passed.*?(\d+) failed/s);
      const ts = sh("pnpm exec vitest run 2>&1 | grep -E '^ *Tests ' | tail -1").trim();
      const solOk = /0 failed/.test(out);
      const tsOk = !/failed/.test(ts) || /0 failed/.test(ts);
      return (solOk && tsOk ? pass : fail)([
        `solidity: ${out.split("\n").filter(Boolean).pop()?.trim() ?? "?"}`,
        `typescript: ${ts || "(none)"}`,
      ]);
    },
  },
  {
    id: "C2", name: "All wallets provisioned", phase: "1 Foundations",
    async run() {
      const pc = rd();
      const under: string[] = [];
      let total = 0n;
      // Operational floor, not the top-up target: wallets legitimately sit just below
      // target after spending gas, and failing on that produces constant false alarms.
      const FLOOR = 0.5;
      for (const w of allWallets()) {
        const b = await pc.getBalance({ address: w.account.address });
        total += b;
        if (Number(formatEther(b)) < targetFor(w.label) * FLOOR) under.push(`${w.label} ${Number(formatEther(b)).toFixed(6)}`);
      }
      const ev = [`${allWallets().length} wallets`, `combined ${formatEther(total)} ETH`, `floor ${FLOOR * 100}% of top-up target`];
      return under.length === 0 ? pass(ev) : fail([...ev, `below floor: ${under.join(", ")}`], ["run: pnpm fund"]);
    },
  },
  {
    id: "C5", name: "Contracts deployed and verified", phase: "2 Contracts",
    async run() {
      const pc = rd();
      const m = readManifest().contracts;
      const ev: string[] = [];
      let bad = 0;
      for (const [name, e] of Object.entries(m)) {
        if (name.startsWith("agentId.")) continue;
        const code = await pc.getBytecode({ address: e.address as Hex });
        const ok = !!code && code.length > 2;
        if (!ok) bad++;
        ev.push(`${ok ? "✓" : "✗"} ${name} ${e.address}${e.verifiedUrl ? " (verified)" : ""}`);
      }
      return (bad === 0 ? pass : fail)(ev);
    },
  },
  {
    id: "C8", name: "agentId → score adapter", phase: "2 Contracts",
    async run() {
      const pc = rd();
      const m = readManifest().contracts;
      const adapter = m.reputationRegistryAdapter?.address as Hex | undefined;
      if (!adapter) return fail(["reputationRegistryAdapter not deployed"]);
      const abi = [{ name: "scoreByAgentId", type: "function", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint32" }] }] as const;
      const ev: string[] = [];
      for (const id of [1n, 2n, 3n]) {
        try {
          const s = await pc.readContract({ address: adapter, abi, functionName: "scoreByAgentId", args: [id] }) as number;
          ev.push(`agentId ${id} → score ${s}`);
        } catch (e) { return fail([...ev, `agentId ${id} threw`]); }
      }
      return pass(ev);
    },
  },
  {
    id: "S1", name: "SolventBook oracle live", phase: "Solvent",
    async run() {
      const pc = rd();
      const m = readManifest().contracts;
      const book = m.solventBook?.address as Hex | undefined;
      if (!book) return fail(["solventBook not deployed"]);
      const abi = [{ name: "computeUtilisationBps", type: "function", stateMutability: "pure",
        inputs: [{ type: "uint128" }, { type: "uint128" }], outputs: [{ type: "uint32" }] }] as const;
      const u = await pc.readContract({ address: book, abi, functionName: "computeUtilisationBps", args: [300000n, 100000n] }) as number;
      return (u === 30_000 ? pass : fail)([`whitepaper 3x case reads ${u} bps on-chain`]);
    },
  },
  {
    id: "S2", name: "Solvent router with 4 instructions", phase: "Solvent",
    async run() {
      const pc = rd();
      const m = readManifest().contracts;
      const r = m.router?.address as Hex | undefined;
      if (!r) return fail(["router not deployed"]);
      const abi = [{ name: "SOLVENT_OPCODE_COUNT", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }] as const;
      const n = await pc.readContract({ address: r, abi, functionName: "SOLVENT_OPCODE_COUNT" }) as bigint;
      const aquaAbi = [{ name: "AQUA", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }] as const;
      const aqua = await pc.readContract({ address: r, abi: aquaAbi, functionName: "AQUA" }) as string;
      const linked = aqua.toLowerCase() === (m.aqua.address as string).toLowerCase();
      const out = sh("cd contracts && forge test --match-contract SolvencyInstructionsTest 2>&1 | tail -2");
      return (n === 4n && linked && /0 failed/.test(out) ? pass : fail)([
        `SOLVENT_OPCODE_COUNT = ${n} (floor 0x22, skew 0xb5, gate 0x21, adjuster 0xb3)`,
        `router.AQUA ${linked ? "linked to our Aqua" : "MISLINKED " + aqua}`,
        out.split("\n").filter(Boolean).pop()?.trim() ?? "?",
      ]);
    },
  },
  {
    id: "S3", name: "Maker books indexed live", phase: "Solvent",
    async run() {
      const d = await gql<{ makerBooks: { maker: string; token: string; committed: string; backing: string; utilisationBps: string }[] }>(
        `{ makerBooks(orderBy: utilisationBps, orderDirection: desc, first: 20) { maker token committed backing utilisationBps } }`);
      if (d.makerBooks.length === 0) return fail(["no maker books indexed"], ["redeploy subgraph or run seed scripts"]);
      const ev = d.makerBooks.slice(0, 6).map((b) =>
        `${b.maker.slice(0, 10)} ${b.token.slice(0, 10)} committed ${b.committed} backing ${b.backing} util ${b.utilisationBps}bps`);
      // sanity: utilisation must equal the TS formula for every row
      const { computeUtilisationBps } = await import("@aqua-solvent/core");
      const bad = d.makerBooks.filter((b) => String(computeUtilisationBps(BigInt(b.committed), BigInt(b.backing))) !== b.utilisationBps);
      return (bad.length === 0 ? pass : fail)([`${d.makerBooks.length} books`, ...ev],
        bad.length ? [`${bad.length} books disagree with computeUtilisationBps`] : undefined);
    },
  },
  {
    id: "S4", name: "On-chain oracle mirrors the index", phase: "Solvent",
    async run() {
      const pc = rd();
      const book = readManifest().contracts.solventBook.address as Hex;
      const abi = [{ name: "bookOf", type: "function", stateMutability: "view",
        inputs: [{ type: "address" }, { type: "address" }],
        outputs: [{ type: "tuple", components: [
          { type: "uint128", name: "committed" }, { type: "uint128", name: "backing" }, { type: "uint64", name: "updatedAt" }] }] }] as const;
      const aqua = readManifest().contracts.aqua.address as Hex;
      const erc = [
        { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
        { name: "allowance", type: "function", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
      ] as const;
      const d = await gql<{ makerBooks: { maker: Hex; token: Hex; committed: string }[] }>(
        `{ makerBooks(first: 100) { maker token committed } }`);
      if (d.makerBooks.length === 0) return fail(["no maker books indexed"]);
      // committed must match the index exactly; backing must match a live chain read,
      // because the attestor refreshes backing at write time (wallets drain without events)
      const drift: string[] = [];
      for (const b of d.makerBooks) {
        const oc = await pc.readContract({ address: book, abi, functionName: "bookOf", args: [b.maker, b.token] }) as { committed: bigint; backing: bigint };
        const bal = await pc.readContract({ address: b.token, abi: erc, functionName: "balanceOf", args: [b.maker] }) as bigint;
        const alw = await pc.readContract({ address: b.token, abi: erc, functionName: "allowance", args: [b.maker, aqua] }) as bigint;
        const live = bal < alw ? bal : alw;
        if (oc.committed !== BigInt(b.committed) || oc.backing !== live)
          drift.push(`${b.maker.slice(0, 10)} ${b.token.slice(0, 10)} chain ${oc.committed}/${oc.backing} vs index ${b.committed} live ${live}`);
      }
      return (drift.length === 0 ? pass : fail)(
        [`${d.makerBooks.length} books: committed == index, backing == live wallet`, ...drift.slice(0, 4)],
        drift.length ? ["run pnpm attest:books to sync"] : undefined);
    },
  },
  {
    id: "S5", name: "Demo books quote their live risk", phase: "Solvent",
    async run() {
      // the demo maker (wallet 37): its books were shipped with floor 9500 and
      // skew from 5000; quoting must agree with the on-chain oracle, live
      const pc = rd();
      const maker = account(37);
      const A = addrs();
      const d = await gql<{ strategies: { id: Hex; program: Hex }[] }>(
        `{ strategies(where: { maker: "${maker.address.toLowerCase()}", active: true }, first: 5) { id program } }`);
      if (d.strategies.length === 0) return fail(["no demo strategies indexed"], ["run pnpm demo --fast"]);
      const bookAbi = [{ name: "utilisationBps", type: "function", stateMutability: "view",
        inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint32" }] }] as const;
      const u = await pc.readContract({ address: A.solventBook, abi: bookAbi, functionName: "utilisationBps", args: [maker.address, A.weth] }) as number;
      const order = await buildOrder({ maker: maker.address, tokenA: A.usdc, tokenB: A.weth, program: d.strategies[0].program });
      const td = await buildTakerData({ taker: role("bob").address, isAToB: true });
      let quoted: bigint | null = null;
      try {
        const q = await pc.readContract({
          address: A.router, abi: SWAP_ABI, functionName: "quote",
          args: [order, 10_000_000n, td] as never, account: role("bob").address,
        }) as readonly [bigint, bigint, Hex];
        quoted = q[1];
      } catch { quoted = null; }
      const floored = u >= 9_500;
      const consistent = floored === (quoted === null);
      return (consistent ? pass : fail)([
        `book utilisation ${u}bps (floor 9500)`,
        quoted === null ? "quote declined by SolvencyFloor" : `quote ${formatUnits(quoted, 18)} WETH for 10 USDC`,
        `oracle and quoter agree: ${consistent}`,
      ], consistent ? undefined : ["book and router disagree - rerun pnpm attest:books"]);
    },
  },
  {
    id: "S6", name: "Dashboard builds on live data", phase: "Solvent",
    async run() {
      const out = sh("cd dashboard && pnpm exec vite build 2>&1 | tail -1");
      const built = /built in/.test(out);
      const url = env.SUBGRAPH_URL_BASE;
      if (!url) return fail(["SUBGRAPH_URL_BASE not set"]);
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "{ makerBooks(first: 100) { id } _meta { hasIndexingErrors } }" }) });
      const j = await r.json() as { data: { makerBooks: { id: string }[]; _meta: { hasIndexingErrors: boolean } } };
      const n = j.data.makerBooks.length;
      const ok = built && n > 0 && !j.data._meta.hasIndexingErrors;
      return (ok ? pass : fail)([
        out.trim(),
        `aqua-solvent-base serving ${n} live maker books, errors ${j.data._meta.hasIndexingErrors}`,
      ]);
    },
  },
  {
    id: "C10/11", name: "Fill-and-revert proof + invariants", phase: "2 Contracts",
    async run() {
      const a = sh("cd contracts && forge test --match-contract FillAndRevertTest 2>&1 | tail -2");
      const b = sh("cd contracts && forge test --match-path 'test/invariant/*' 2>&1 | tail -2");
      const ok = /0 failed/.test(a) && /0 failed/.test(b);
      return (ok ? pass : fail)([
        `fill/revert: ${a.split("\n").filter(Boolean).pop()?.trim() ?? "?"}`,
        `invariants: ${b.split("\n").filter(Boolean).pop()?.trim() ?? "?"}`,
      ]);
    },
  },
  {
    id: "C9", name: "TS↔Solidity program encoding", phase: "2 Contracts",
    async run() {
      sh("pnpm exec tsx scripts/gen-program-fixtures.ts");
      const out = sh("cd contracts && forge test --match-contract ProgramRoundTripTest 2>&1 | tail -2");
      return (/0 failed/.test(out) ? pass : fail)([out.split("\n").filter(Boolean).pop()?.trim() ?? "?"]);
    },
  },
  {
    id: "C22/23", name: "Cost-to-fake measured", phase: "6 Adversarial",
    async run() {
      const need = ["docs/cost-to-fake.json", "docs/cost-to-fake-reviews.json", "docs/COST_TO_FAKE.md", "docs/score-simulation.md"];
      const missing = need.filter((f) => !existsSync(resolve(REPO_ROOT, f)));
      if (missing.length) return fail([`missing: ${missing.join(", ")}`], ["run: pnpm attack:all"]);
      const wash = JSON.parse(readFileSync(resolve(REPO_ROOT, "docs/cost-to-fake.json"), "utf8"));
      const rev = JSON.parse(readFileSync(resolve(REPO_ROOT, "docs/cost-to-fake-reviews.json"), "utf8"));
      const ev = [
        `reviews: $${rev.mainnetEquivalentUsdTotal} gas, $0 capital → PoF score 0`,
        `wash trade: $${wash.gasMainnetEquivalentUsd} gas, $${wash.capitalRequiredUsd.toLocaleString()} capital → score ${wash.scoreAchieved}`,
        `single-counterparty variant → score ${wash.scoreWithOnePuppet}`,
      ];
      // the structural claim must hold in the measured data
      return (wash.scoreWithOnePuppet === "0" ? pass : fail)(ev,
        wash.scoreWithOnePuppet !== "0" ? ["self-dealing produced a non-zero score — the diversity term is broken"] : undefined);
    },
  },
  {
    id: "C13/14", name: "Subgraph live on Studio", phase: "4 Data",
    async run() {
      const pc = rd();
      const head = await subgraphHead();
      const chain = Number(await pc.getBlockNumber());
      const lag = chain - head.block;
      const ev = [
        `endpoint ${env.SUBGRAPH_URL}`,
        `subgraph @ ${head.block} · chain @ ${chain} · lag ${lag} blocks`,
        `indexing errors: ${head.hasIndexingErrors}`,
      ];
      if (head.hasIndexingErrors) return fail(ev);
      if (lag > 50) return fail([...ev, `lag exceeds the 50-block demo gate`]);
      return pass(ev);
    },
  },
  {
    id: "C15", name: "Failed fills indexed", phase: "4 Data",
    async run() {
      const d = await gql<{ global: { totalFills: number; totalHonored: number; totalFailed: number } | null; fills: any[] }>(
        `{ global(id:"global"){ totalFills totalHonored totalFailed }
           fills(where:{status:FAILED}, first:5){ reason failedTxHash source maker{id} } }`);
      const ev = [
        `fills ${d.global?.totalFills ?? 0} — honored ${d.global?.totalHonored ?? 0}, failed ${d.global?.totalFailed ?? 0}`,
        ...d.fills.map((f) => `FAILED reason=${f.reason} proof=${f.failedTxHash?.slice(0, 14)}… source=${f.source === 0 ? "attestor" : "self"}`),
      ];
      return (d.fills.length > 0 ? pass : fail)(ev,
        d.fills.length === 0 ? ["no broken promise has been recorded — run: pnpm alice betray && pnpm attest:failures"] : undefined);
    },
  },
  {
    id: "C16", name: "Score parity TS↔Solidity", phase: "4 Data",
    async run() {
      sh("pnpm exec tsx scripts/gen-score-fixtures.ts");
      const out = sh("cd contracts && forge test --match-contract ScoreDifferentialTest 2>&1 | tail -2");
      const n = JSON.parse(readFileSync(resolve(REPO_ROOT, "contracts/test/fixtures/scores.json"), "utf8")).count;
      return (/0 failed/.test(out) ? pass : fail)([`${n} cases`, out.split("\n").filter(Boolean).pop()?.trim() ?? "?"]);
    },
  },
  {
    id: "C17", name: "On-chain scores match subgraph", phase: "5 Services",
    async run() {
      const pc = rd();
      const A = addrs();
      const d = await gql<{ agents: any[] }>(`{ agents(where:{honoredCount_gt:0}){ id honoredValueUsd6 honoredCount failedCount diversityBps settlementScore } }`);
      const ev: string[] = [];
      let stale = 0;
      for (const a of d.agents) {
        const onChain = await pc.readContract({ address: A.score, abi: SCORE_ABI, functionName: "scoreOf", args: [a.id] }) as number;
        const derived = computeScore({ honoredValueUsd6: BigInt(a.honoredValueUsd6), honoredCount: a.honoredCount, failedCount: a.failedCount, diversityBps: a.diversityBps });
        const match = BigInt(onChain) === derived;
        if (!match) stale++;
        ev.push(`${match ? "✓" : "≠"} ${a.id.slice(0, 10)} on-chain ${onChain} / derived ${derived}`);
      }
      return (stale === 0 ? pass : fail)(ev, stale ? ["run: pnpm attest"] : undefined);
    },
  },
  {
    id: "C19", name: "ERC-8004 registries and agents", phase: "5 Services",
    async run() {
      const d = await gql<{ agents: any[] }>(`{ agents(where:{agentId_not:null}){ id agentId reviewCount reviewAvgBps honoredCount } }`);
      const m = readManifest().contracts;
      const ev = [
        `identity ${m.identityRegistry?.address ?? "MISSING"}`,
        `reputation ${m.reputationRegistry?.address ?? "MISSING"}`,
        `validation ${m.validationRegistry?.address ?? "MISSING"}`,
        ...d.agents.map((a) => `agentId ${a.agentId} ${a.id.slice(0, 10)} — ★${(a.reviewAvgBps / 10000).toFixed(2)} (${a.reviewCount} reviews), ${a.honoredCount} fills`),
      ];
      const seeded = d.agents.filter((a) => a.reviewCount >= 20).length;
      return (seeded >= 2 ? pass : fail)(ev, seeded < 2 ? ["expected 2 agents with 20 reviews — run: pnpm exec tsx scripts/seed-agents.ts"] : undefined);
    },
  },
  {
    id: "C20", name: "Claimed vs delivered separation", phase: "5 Services",
    async run() {
      const d = await gql<{ agents: any[] }>(`{ agents(where:{reviewCount_gte:20}){ id reviewCount reviewAvgBps honoredCount settlementScore } }`);
      if (d.agents.length < 2) return fail([`only ${d.agents.length} reviewed agents`]);
      const sameReviews = new Set(d.agents.map((a) => `${a.reviewCount}:${a.reviewAvgBps}`)).size === 1;
      const differentDelivery = new Set(d.agents.map((a) => a.honoredCount > 0)).size > 1;
      return (sameReviews && differentDelivery ? pass : fail)([
        ...d.agents.map((a) => `${a.id.slice(0, 10)} ★${(a.reviewAvgBps / 10000).toFixed(2)} (${a.reviewCount}) · ${a.honoredCount} fills · score ${a.settlementScore}`),
        sameReviews ? "identical on reviews ✓" : "reviews differ ✗",
        differentDelivery ? "separated by delivery ✓" : "delivery identical ✗",
      ]);
    },
  },
];
