import { chromium } from "playwright";
import { resolve } from "node:path";
import { REPO_ROOT } from "@solvent/core";

const URL = process.env.DASH_URL ?? "http://localhost:4173";
const out = resolve(REPO_ROOT, "docs/screenshots");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });

const errors: string[] = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(URL, { waitUntil: "networkidle" });
// wait for live data rather than a fixed sleep
await page.waitForSelector(".row", { timeout: 30_000 });
await page.waitForTimeout(1200);

await page.screenshot({ path: resolve(out, "ledger.png"), fullPage: false });
await page.screenshot({ path: resolve(out, "ledger-full.png"), fullPage: true });

const rows = await page.locator(".row").count();
const stamps = await page.locator(".stamp").allTextContents();
const links = await page.locator('a[href^="https://sepolia.basescan.org"]').count();

// open the drawer on the first agent
await page.locator(".row").first().click();
await page.waitForSelector(".drawer", { timeout: 5000 });
await page.waitForTimeout(500);
await page.screenshot({ path: resolve(out, "statement.png") });

console.log(`  rows: ${rows}`);
console.log(`  stamps: ${stamps.map((s) => s.trim()).join(" | ")}`);
console.log(`  explorer links: ${links}`);
console.log(`  console errors: ${errors.length}${errors.length ? " → " + errors.slice(0, 3).join(" ; ") : ""}`);
console.log(`  → docs/screenshots/{ledger,ledger-full,statement}.png`);

await browser.close();
process.exit(errors.length === 0 ? 0 : 1);
