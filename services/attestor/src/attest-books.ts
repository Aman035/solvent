import { activeChain, addrs, explorerAddr, readManifest } from "@aqua-solvent/core";
import { attestBooks } from "./books.js";

console.log(`\n═══ ATTESTOR: MAKER BOOKS -> SOLVENT BOOK ═══`);
console.log(`  chain  ${activeChain.key}`);
console.log(`  oracle ${explorerAddr(readManifest().contracts.solventBook.address)}\n`);
const n = await attestBooks();
console.log(`\n  ${n === 0 ? "nothing to write" : `${n} books written on-chain`}\n`);
