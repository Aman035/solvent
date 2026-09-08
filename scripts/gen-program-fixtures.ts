import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { program, REPO_ROOT } from "@solvent/core";

const ORACLE = "0x95908bb174224f085b0f30d6236a46b27c7a6711";

const fixtures = {
  oracle: ORACLE,
  gateOnly: program().gate(ORACLE, 100).encode(),
  gateThenXyc: program().gate(ORACLE, 100).xyc().encode(),
  widenThenXyc: program().widen(ORACLE, 1_000, 300_000).xyc().encode(),
  full: program().gate(ORACLE, 100).widen(ORACLE, 1_000, 300_000).xyc().fee(30_000).encode(),
  xycOnly: program().xyc().encode(),
  feeOnly: program().fee(30_000).encode(),
  saltOnly: program().salt(12_345n).encode(),
  deadlineOnly: program().deadline(1_800_000_000).encode(),
  solvencyFloorOnly: program().solvencyFloor(ORACLE, 9_000).encode(),
  solventStack: program().solvencyFloor(ORACLE, 9_500).solvencySkew(ORACLE, 7_000, 500_000).xyc().fee(30_000).encode(),
};

const out = resolve(REPO_ROOT, "contracts/test/fixtures/programs.json");
writeFileSync(out, JSON.stringify(fixtures, null, 2) + "\n");
console.log(`  wrote ${out}`);
for (const [k, v] of Object.entries(fixtures)) {
  if (k !== "oracle") console.log(`    ${k.padEnd(14)} ${v}`);
}
