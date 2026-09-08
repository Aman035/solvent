import { execSync } from "node:child_process";
import { formatUnits } from "viem";
import { readClient, role, addrs, ERC20_ABI, REPO_ROOT } from "@aqua-solvent/core";

/**
 * Return the ledger to the state the video opens from.
 *
 * Aqua strategies are immutable and fills are permanent, so "reset" means restoring
 * Alice's ability to deliver and topping up gas - not erasing history. The failed fill
 * stays on the record, which is the point of the system.
 */
const rd = readClient();
const A = addrs();
const alice = role("alice");

console.log(`\n═══ DEMO RESET ═══\n`);
const w = await rd.readContract({ address: A.weth, abi: ERC20_ABI, functionName: "balanceOf", args: [alice.address] }) as bigint;
console.log(`  Alice holds ${formatUnits(w, 18)} pofWETH`);

if (w === 0n) {
  console.log(`  restoring inventory so she can deliver again…`);
  execSync("pnpm exec tsx agents/maker/src/index.ts restore", { cwd: REPO_ROOT, stdio: "inherit" });
} else {
  console.log(`  ✅ already able to deliver`);
}

console.log(`\n  topping up gas…`);
execSync("pnpm exec tsx scripts/fund.ts", { cwd: REPO_ROOT, stdio: "inherit" });

console.log(`\n  syncing scores…`);
execSync("pnpm exec tsx services/attestor/src/index.ts --once", { cwd: REPO_ROOT, stdio: "inherit" });

console.log(`\n  Note: the failed fill stays on the record permanently — that is the system working.`);
console.log(`  Ready. Verify with: pnpm demo:check\n`);
