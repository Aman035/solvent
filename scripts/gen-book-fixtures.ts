import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { computeUtilisationBps, REPO_ROOT } from "@pof/core";

let seed = 0x51e17;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };
const U128 = (1n << 128n) - 1n;

const cases: { committed: string; backing: string; expected: string }[] = [];
const edge: [bigint, bigint][] = [
  [0n, 0n], [0n, 1n], [1n, 0n], [1n, 1n],
  [10n ** 19n, 10n ** 19n], [3n * 10n ** 11n, 10n ** 11n],
  [U128, 1n], [1n, U128], [U128, U128],
];
for (const [c, b] of edge) cases.push({ committed: c.toString(), backing: b.toString(), expected: String(computeUtilisationBps(c, b)) });
for (let i = 0; i < 1000; i++) {
  const mag = [1n, 10n ** 6n, 10n ** 12n, 10n ** 18n, 10n ** 24n, 1n << 100n][Math.floor(rnd() * 6)];
  const c = (BigInt(Math.floor(rnd() * 1e9)) * mag) % U128;
  const b = (BigInt(Math.floor(rnd() * 1e9)) * mag) % U128;
  cases.push({ committed: c.toString(), backing: b.toString(), expected: String(computeUtilisationBps(c, b)) });
}
writeFileSync(resolve(REPO_ROOT, "contracts/test/fixtures/books.json"),
  JSON.stringify({ count: cases.length, cases }, null, 1) + "\n");
console.log(`  ${cases.length} book cases written`);
