import { decodeEventLog, formatUnits, type Hex } from "viem";
import { publicClient, readManifest, role } from "@pof/core";
const pc = publicClient();
const m = readManifest().contracts;
const rc = await pc.getTransactionReceipt({ hash: "0xd6b5498a24aa5db83225c7f17324226a466bcc4f6b69225b8e2304cea9585fa2" });
const names: Record<string,string> = {};
for (const [k,v] of Object.entries(m)) names[(v as any).address.toLowerCase()] = k;
for (const r of ["alice","bob","attestor"] as const) names[role(r).address.toLowerCase()] = r;

const abis = [
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Pulled(address maker, address app, bytes32 strategyHash, address token, uint256 amount)",
  "event Pushed(address maker, address app, bytes32 strategyHash, address token, uint256 amount)",
  "event Swapped(bytes32 orderHash, address maker, address taker, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut)",
];
import { parseAbi } from "viem";
const abi = parseAbi(abis as any);
const n = (a: string) => names[a.toLowerCase()] ?? a.slice(0,10);
console.log(`  status=${rc.status}  gas=${rc.gasUsed}  logs=${rc.logs.length}\n`);
for (const l of rc.logs) {
  try {
    const d = decodeEventLog({ abi, data: l.data, topics: l.topics }) as any;
    const src = n(l.address);
    if (d.eventName === "Transfer") {
      const dec = src === "usdc" ? 6 : 18;
      console.log(`  ${src.padEnd(8)} Transfer  ${n(d.args.from).padEnd(10)} -> ${n(d.args.to).padEnd(10)} ${formatUnits(d.args.value, dec)}`);
    } else if (d.eventName === "Swapped") {
      console.log(`  ${src.padEnd(8)} Swapped   maker=${n(d.args.maker)} taker=${n(d.args.taker)} in=${d.args.amountIn} out=${d.args.amountOut}`);
    } else {
      console.log(`  ${src.padEnd(8)} ${d.eventName.padEnd(9)} maker=${n(d.args.maker)} token=${n(d.args.token)} amount=${d.args.amount}`);
    }
  } catch { console.log(`  ${n(l.address).padEnd(8)} (undecoded) ${l.topics[0]?.slice(0,12)}`); }
}
