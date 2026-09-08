import { type Hex } from "viem";
import { readClient, role, addrs, gql, tx, explorerAddr, activeChain } from "@solvent/core";

/**
 * Book attestation: write every maker's balance sheet into SolventBook, the on-chain
 * oracle the SolvencyFloor and SolvencySkew instructions read during quotes.
 *
 * committed comes from the index - it only changes on Aqua events, which the subgraph
 * sees exactly. backing is re-read live from the chain here, because a maker's wallet
 * can drain with no Aqua event at all (a sweep, a fill on another venue, a revoked
 * allowance) and that is precisely the moment the oracle must not be stale.
 *
 * Writes are diffed against chain state first, so a quiet market costs nothing.
 */

const BOOK_ABI = [
  { name: "setBooks", type: "function", stateMutability: "nonpayable",
    inputs: [
      { type: "address[]", name: "makers" }, { type: "address[]", name: "tokens" },
      { type: "uint128[]", name: "committed" }, { type: "uint128[]", name: "backing" },
    ], outputs: [] },
  { name: "bookOf", type: "function", stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }],
    outputs: [{ type: "tuple", components: [
      { type: "uint128", name: "committed" }, { type: "uint128", name: "backing" }, { type: "uint64", name: "updatedAt" },
    ] }] },
] as const;

interface IndexedBook { maker: Hex; token: Hex; committed: string; backing: string; utilisationBps: string }

export async function attestBooks(): Promise<number> {
  const pc = readClient();
  const A = addrs();
  const attestor = role("attestor");
  const book = (A as any).solventBook ?? undefined;
  const bookAddr = book ?? (await import("@solvent/core")).readManifest().contracts.solventBook.address as Hex;

  const d = await gql<{ makerBooks: IndexedBook[] }>(
    `{ makerBooks(first: 500) { maker token committed backing utilisationBps } }`);
  const aqua = A.aqua;

  const makers: Hex[] = []; const tokens: Hex[] = [];
  const committed: bigint[] = []; const backing: bigint[] = [];

  const ERC20 = [
    { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
    { name: "allowance", type: "function", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  ] as const;

  for (const b of d.makerBooks) {
    const onChain = await pc.readContract({
      address: bookAddr, abi: BOOK_ABI, functionName: "bookOf", args: [b.maker, b.token],
    }) as { committed: bigint; backing: bigint; updatedAt: bigint };
    const c = BigInt(b.committed);
    // live backing: min(wallet balance, allowance to Aqua) right now
    const bal = await pc.readContract({ address: b.token, abi: ERC20, functionName: "balanceOf", args: [b.maker] }) as bigint;
    const alw = await pc.readContract({ address: b.token, abi: ERC20, functionName: "allowance", args: [b.maker, aqua] }) as bigint;
    const k = bal < alw ? bal : alw;
    if (onChain.committed === c && onChain.backing === k) {
      console.log(`  = ${b.maker.slice(0, 10)} ${b.token.slice(0, 10)} current`);
      continue;
    }
    console.log(`  → ${b.maker.slice(0, 10)} ${b.token.slice(0, 10)} committed ${onChain.committed} -> ${c} · backing ${onChain.backing} -> ${k}`);
    makers.push(b.maker); tokens.push(b.token); committed.push(c); backing.push(k);
  }

  if (makers.length === 0) { console.log(`  all ${d.makerBooks.length} books current on-chain`); return 0; }
  await tx(attestor, `setBooks(${makers.length})`, {
    address: bookAddr, abi: BOOK_ABI, functionName: "setBooks", args: [makers, tokens, committed, backing],
  });
  return makers.length;
}
