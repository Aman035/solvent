import { execSync } from "node:child_process";
import { REPO_ROOT } from "@pof/core";

/**
 * The three scenarios, in the order the video tells them.
 *
 * Each is a real transaction on Base Sepolia. Nothing here is simulated, and nothing is
 * pre-recorded - which is why `pnpm demo:check` must pass first.
 */
const only = process.argv[2];
const run = (cmd: string) => execSync(cmd, { cwd: REPO_ROOT, stdio: "inherit" });
const rule = (n: string, t: string) => {
  console.log(`\n\n\x1b[38;5;79m${"═".repeat(72)}\x1b[0m`);
  console.log(`\x1b[38;5;79m  SCENARIO ${n}\x1b[0m  ${t}`);
  console.log(`\x1b[38;5;79m${"═".repeat(72)}\x1b[0m`);
};

if (!only || only === "1") {
  rule("1", "An agent chooses a counterparty from live Graph data");
  run("pnpm exec tsx agents/taker/src/index.ts 500");
}

if (!only || only === "2") {
  rule("2", "A maker refuses a taker with no track record — at quote time");
  run("pnpm exec tsx scripts/gate-enforce.ts");
}

if (!only || only === "3") {
  rule("3", "A maker breaks a promise, and the chain records it");
  run("pnpm exec tsx agents/maker/src/index.ts betray");
  run("pnpm exec tsx scripts/betray-flow.ts");
  run("pnpm exec tsx services/attestor/src/scan.ts 200");
  console.log(`\n  Wait ~30s for the subgraph to index, then:`);
  run("pnpm exec tsx scripts/show-contrast.ts");
}

console.log(`\n\n  Scenarios complete. Restore the ledger with: pnpm demo:reset\n`);
