import { type Hex } from "viem";
import { readClient, role, addrs, gql, tx, explorerAddr, activeChain } from "@pof/core";

/**
 * Book attestation: copy every maker's indexed balance sheet into SolventBook, the
 * on-chain oracle the SolvencyFloor and SolvencySkew instructions read during quotes.
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
  const bookAddr = book ?? (await import("@pof/core")).readManifest().contracts.solventBook.address as Hex;

  const d = await gql<{ makerBooks: IndexedBook[] }>(
    `{ makerBooks(first: 500) { maker token committed backing utilisationBps } }`);

  const makers: Hex[] = []; const tokens: Hex[] = [];
  const committed: bigint[] = []; const backing: bigint[] = [];

  for (const b of d.makerBooks) {
    const onChain = await pc.readContract({
      address: bookAddr, abi: BOOK_ABI, functionName: "bookOf", args: [b.maker, b.token],
    }) as { committed: bigint; backing: bigint; updatedAt: bigint };
    const c = BigInt(b.committed); const k = BigInt(b.backing);
    if (onChain.committed === c && onChain.backing === k) {
      console.log(`  = ${b.maker.slice(0, 10)} ${b.token.slice(0, 10)} current (util ${b.utilisationBps}bps)`);
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
