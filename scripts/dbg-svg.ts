import { chromium } from "playwright";
import { resolve } from "node:path";
import { REPO_ROOT } from "@pof/core";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1000, height: 420 } });
await p.goto("file://" + resolve(REPO_ROOT, "docs/graphics/phantom-liquidity.svg"));
await p.screenshot({ path: resolve(REPO_ROOT, "docs/screenshots/chart-check.png") });
await b.close();
console.log("ok");
