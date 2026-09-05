import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatUnits, formatEther, type Hex } from "viem";
import {
  readClient, role, allWallets, targetFor, addrs, readManifest, activeChain,
  subgraphHead, gql, computeScore, env, REPO_ROOT, ERC20_ABI,
} from "@pof/core";
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
    id: "C7", name: "Custom opcodes live on-chain", phase: "2 Contracts",
    async run() {
      const pc = rd();
      const A = addrs();
      const n = await pc.readContract({
        address: A.router, abi: [{ name: "PROOF_OF_FILL_OPCODE_COUNT", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }] as const,
        functionName: "PROOF_OF_FILL_OPCODE_COUNT",
      }) as bigint;
      const aqua = await pc.readContract({
        address: A.router, abi: [{ name: "AQUA", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }] as const,
        functionName: "AQUA",
      }) as Hex;
      const linked = aqua.toLowerCase() === A.aqua.toLowerCase();
      return (n === 2n && linked ? pass : fail)([
        `PROOF_OF_FILL_OPCODE_COUNT = ${n} (ReputationGate 0x21, ReputationPriceAdjuster 0xb3)`,
        `router.AQUA ${linked ? "→ our Aqua ✓" : `MISLINKED ${aqua}`}`,
      ]);
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
      const d = await gql<{ agents: any[] }>(`{ agents(where:{honoredCount_gt:0}){ id honoredValueUsd6 honoredCount failedCount diversityBps proofOfFillScore } }`);
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
      const d = await gql<{ agents: any[] }>(`{ agents(where:{reviewCount_gte:20}){ id reviewCount reviewAvgBps honoredCount proofOfFillScore } }`);
      if (d.agents.length < 2) return fail([`only ${d.agents.length} reviewed agents`]);
      const sameReviews = new Set(d.agents.map((a) => `${a.reviewCount}:${a.reviewAvgBps}`)).size === 1;
      const differentDelivery = new Set(d.agents.map((a) => a.honoredCount > 0)).size > 1;
      return (sameReviews && differentDelivery ? pass : fail)([
        ...d.agents.map((a) => `${a.id.slice(0, 10)} ★${(a.reviewAvgBps / 10000).toFixed(2)} (${a.reviewCount}) · ${a.honoredCount} fills · score ${a.proofOfFillScore}`),
        sameReviews ? "identical on reviews ✓" : "reviews differ ✗",
        differentDelivery ? "separated by delivery ✓" : "delivery identical ✗",
      ]);
    },
  },
];
