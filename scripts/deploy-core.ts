import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatEther } from "viem";
import {
  publicClient, walletClient, role, activeChain, explorerAddr,
  writeEntry, readManifest, REPO_ROOT,
} from "@pof/core";

const SWAP_VM_COMMIT = "f09a41e689240adc645934f965c8061749397cd2";
const AQUA_COMMIT = "9c5c42e5840e8741fba3597c48456c9510212b66";

function artifact(sol: string, name: string) {
  const p = resolve(REPO_ROOT, "contracts/out", sol, `${name}.json`);
  const j = JSON.parse(readFileSync(p, "utf8"));
  return { abi: j.abi, bytecode: j.bytecode.object as `0x${string}` };
}

const pc = publicClient();
const deployer = role("deployer");
const attestor = role("attestor");
const wc = walletClient(deployer);

console.log(`\n  deploying to ${activeChain.key} (${activeChain.chainId})`);
console.log(`  deployer: ${deployer.address}`);
console.log(`  balance : ${formatEther(await pc.getBalance({ address: deployer.address }))} ETH\n`);

async function deploy(
  label: string, sol: string, name: string, args: unknown[], sourceCommit?: string,
) {
  const existing = readManifest().contracts[label];
  if (existing) {
    const code = await pc.getBytecode({ address: existing.address as `0x${string}` });
    if (code && code.length > 2) { console.log(`  = ${label.padEnd(18)} ${existing.address}  (already deployed)`); return existing.address as `0x${string}`; }
  }
  const { abi, bytecode } = artifact(sol, name);
  const hash = await wc.deployContract({ abi, bytecode, args: args as never });
  const rc = await pc.waitForTransactionReceipt({ hash });
  if (rc.status !== "success" || !rc.contractAddress) throw new Error(`${label} deployment failed: ${hash}`);
  writeEntry(label, {
    address: rc.contractAddress,
    deployBlock: Number(rc.blockNumber),
    txHash: hash,
    sourceCommit,
  });
  console.log(`  + ${label.padEnd(18)} ${rc.contractAddress}  block ${rc.blockNumber}  gas ${rc.gasUsed}`);
  return rc.contractAddress;
}

// 1. Official Aqua, pinned + unmodified.
const aqua = await deploy("aqua", "Aqua.sol", "Aqua", [], AQUA_COMMIT);

// 2. Score cache (attestor writes, ReputationGate reads).
const score = await deploy("proofOfFillScore", "ProofOfFillScore.sol", "ProofOfFillScore",
  [deployer.address, attestor.address]);

// 3. Official AquaSwapVMRouter shape + our two instructions.
const router = await deploy("router", "ProofOfFillSwapVMRouter.sol", "ProofOfFillSwapVMRouter",
  [aqua, "0x0000000000000000000000000000000000000000", deployer.address, "ProofOfFillSwapVM", "1.0.0"],
  SWAP_VM_COMMIT);

// 4. Demo tokens (open-mint faucet, so the demo never depends on testnet liquidity).
const weth = await deploy("weth", "DemoToken.sol", "DemoToken", ["Proof of Fill WETH", "pofWETH", 18]);
const usdc = await deploy("usdc", "DemoToken.sol", "DemoToken", ["Proof of Fill USDC", "pofUSDC", 6]);

console.log(`\n  remaining: ${formatEther(await pc.getBalance({ address: deployer.address }))} ETH`);
console.log(`  manifest : deployments/${activeChain.chainId}.json`);
console.log(`  router   : ${explorerAddr(router)}\n`);
