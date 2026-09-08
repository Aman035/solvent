import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatUnits, parseUnits, type Hex } from "viem";
import {
  readClient, role, attackerMaker, attackerPuppet, addrs, program, buildOrder,
  buildTakerData, encodeStrategy, orderHash, tx, ensureApproval, strategyBalances,
  diversityBpsFrom, computeScore, ERC20_ABI, AQUA_ABI, SWAP_ABI, REPO_ROOT, explorerAddr,
} from "@solvent/core";

/**
 * COST-TO-FAKE: wash trading.
 *
 * The strongest objection to a settlement-record score is "what stops an agent trading
 * with itself?" The easy answer is "it costs gas + fees + capital" - but that is an
 * assertion. This measures it, and reports the number honestly - including the fact that on a testnet
 * gas is free, so the mainnet-equivalent cost is what matters.
 *
 * It also demonstrates the structural defence: the Herfindahl diversity term means a
 * single-counterparty attacker scores EXACTLY ZERO regardless of volume, and each extra
 * sock puppet costs real money while only partially lifting the cap.
 */

const PUPPET_COUNT = Number(process.argv[2] ?? 3);
const FILLS_PER_PUPPET = Number(process.argv[3] ?? 2);
/** Documented constants - no testnet oracle exists. */
const ETH_USD = 3000;
const BASE_GAS_GWEI = 0.03;   // typical Base mainnet L2 gas price

const rd = readClient();
const A = addrs();
const attacker = attackerMaker();

interface Cost { label: string; gas: bigint; txs: number }
const costs: Cost[] = [];
let totalGas = 0n, totalTxs = 0;

async function meter(label: string, account: any, req: any, quiet = true) {
  const rc = await tx(account, label, req, quiet);
  totalGas += rc.gasUsed; totalTxs++;
  costs.push({ label, gas: rc.gasUsed, txs: 1 });
  return rc;
}

console.log(`\n╔═══════════════════════════════════════════════════════════════════════╗`);
console.log(`║  COST TO FAKE — wash-trading attack                                   ║`);
console.log(`╚═══════════════════════════════════════════════════════════════════════╝`);
console.log(`\n  attacker ${attacker.address}`);
console.log(`  strategy: ${PUPPET_COUNT} sock puppet(s) × ${FILLS_PER_PUPPET} fills each\n`);

const t0 = Date.now();

// ── set up the fake market maker ────────────────────────────────────────
const prog = program().gate(A.score, 0).xyc().fee(30_000);
const order = await buildOrder({ maker: attacker.address, tokenA: A.usdc, tokenB: A.weth, program: prog.encode() });
const sh = await orderHash(order);

const existing = await strategyBalances(attacker.address, sh, A.usdc, A.weth);
if (!existing || (existing.token0 === 0n && existing.token1 === 0n)) {
  console.log(`  [1] attacker capitalises and ships`);
  await meter("mint 10 WETH", attacker, { address: A.weth, abi: ERC20_ABI, functionName: "mint", args: [attacker.address, parseUnits("10", 18)] });
  await meter("mint 20k USDC", attacker, { address: A.usdc, abi: ERC20_ABI, functionName: "mint", args: [attacker.address, parseUnits("20000", 6)] });
  await ensureApproval(attacker, A.weth, A.aqua, "approve aqua weth");
  await ensureApproval(attacker, A.usdc, A.aqua, "approve aqua usdc");
  await meter("aqua.ship", attacker, {
    address: A.aqua, abi: AQUA_ABI, functionName: "ship",
    args: [A.router, encodeStrategy(order), [A.usdc, A.weth], [parseUnits("20000", 6), parseUnits("10", 18)]],
  });
} else {
  console.log(`  [1] attacker already shipped (${formatUnits(existing.token0, 6)} USDC / ${formatUnits(existing.token1, 18)} WETH)`);
}

// ── self-deal ───────────────────────────────────────────────────────────
console.log(`\n  [2] self-dealing: ${PUPPET_COUNT * FILLS_PER_PUPPET} fills`);
const perPuppetValue: bigint[] = [];
let fakedUsd6 = 0n;

for (let p = 0; p < PUPPET_COUNT; p++) {
  const puppet = attackerPuppet(p);
  let puppetValue = 0n;
  for (let f = 0; f < FILLS_PER_PUPPET; f++) {
    const amt = parseUnits("400", 6);
    const bal = await rd.readContract({ address: A.usdc, abi: ERC20_ABI, functionName: "balanceOf", args: [puppet.address] }) as bigint;
    if (bal < amt) await meter(`puppet[${p}] mint`, puppet, { address: A.usdc, abi: ERC20_ABI, functionName: "mint", args: [puppet.address, amt - bal] });
    await ensureApproval(puppet, A.usdc, A.router, `puppet[${p}] approve`);
    const td = await buildTakerData({ taker: puppet.address, isAToB: true });
    const q = await rd.readContract({ address: A.router, abi: SWAP_ABI, functionName: "quote", args: [order, amt, td] as never, account: puppet.address }) as readonly [bigint, bigint, Hex];
    await meter(`puppet[${p}] fill ${f + 1}`, puppet, { address: A.router, abi: SWAP_ABI, functionName: "swap", args: [order, amt, td] });
    // USD the attacker "delivered" to itself
    const usd = (q[1] * 2500n) / 10n ** 18n * 1_000_000n;
    puppetValue += usd; fakedUsd6 += usd;
    process.stdout.write(`      puppet[${p}] fill ${f + 1}: ${formatUnits(q[1], 18)} WETH\n`);
  }
  perPuppetValue.push(puppetValue);
}

const elapsed = (Date.now() - t0) / 1000;

// ── what the score system makes of it ───────────────────────────────────
const diversityBps = diversityBpsFrom(perPuppetValue);
const fakedScore = computeScore({ honoredValueUsd6: fakedUsd6, honoredCount: PUPPET_COUNT * FILLS_PER_PUPPET, failedCount: 0, diversityBps });
const soloScore = computeScore({ honoredValueUsd6: fakedUsd6, honoredCount: PUPPET_COUNT * FILLS_PER_PUPPET, failedCount: 0, diversityBps: diversityBpsFrom([fakedUsd6]) });

const gasCostEth = Number(totalGas) * BASE_GAS_GWEI * 1e-9;
const gasCostUsd = gasCostEth * ETH_USD;
const capitalLocked = 10 * 2500 + 20000;   // the inventory the attacker must actually hold

console.log(`\n  ── measured ──`);
console.log(`  transactions      ${totalTxs}`);
console.log(`  gas used          ${totalGas.toLocaleString()}`);
console.log(`  wall clock        ${elapsed.toFixed(1)}s`);
console.log(`  capital required  $${capitalLocked.toLocaleString()} (inventory that must genuinely be held)`);
console.log(`  gas on Base Sepolia   $0.00 (testnet gas is free — this is why the number below matters)`);
console.log(`  gas mainnet-equivalent $${gasCostUsd.toFixed(4)}  (@ ${BASE_GAS_GWEI} gwei, ETH $${ETH_USD})`);

console.log(`\n  ── what it bought ──`);
console.log(`  volume faked      $${(Number(fakedUsd6) / 1e6).toFixed(2)} across ${PUPPET_COUNT * FILLS_PER_PUPPET} fills`);
console.log(`  counterparties    ${PUPPET_COUNT}`);
console.log(`  diversity         ${(diversityBps / 100).toFixed(2)}%`);
console.log(`  SCORE ACHIEVED    ${fakedScore}`);
console.log(`  with 1 puppet     ${soloScore}   ← single counterparty ⇒ HHI 1 ⇒ diversity 0 ⇒ zero`);

const out = {
  measuredAt: new Date().toISOString(),
  puppets: PUPPET_COUNT, fillsPerPuppet: FILLS_PER_PUPPET,
  transactions: totalTxs, gasUsed: totalGas.toString(), elapsedSeconds: elapsed,
  capitalRequiredUsd: capitalLocked,
  gasMainnetEquivalentUsd: Number(gasCostUsd.toFixed(4)),
  volumeFakedUsd: Number((Number(fakedUsd6) / 1e6).toFixed(2)),
  diversityBps, scoreAchieved: fakedScore.toString(), scoreWithOnePuppet: soloScore.toString(),
  assumptions: { ethUsd: ETH_USD, baseGasGwei: BASE_GAS_GWEI },
  attacker: attacker.address,
};
writeFileSync(resolve(REPO_ROOT, "docs/cost-to-fake.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`\n  → docs/cost-to-fake.json`);
console.log(`  ${explorerAddr(attacker.address)}\n`);
