/**
 * The Solvent brand, generated: wordmark, icon, banner.
 *
 * The mark is the "o" of the wordmark: a vessel filled to its line. Ships carry the
 * same mark on their hulls - load past the line and you sink. The wordmark is drawn
 * as stroked paths (no fonts), so it renders identically everywhere GitHub proxies it.
 *
 * Outputs docs/graphics/{logo-dark,logo-light,icon,banner}.svg
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../docs/graphics");
mkdirSync(OUT, { recursive: true });

const GREEN = "#3fd39b";
const INK_DARK = "#eef1f4";   // strokes on dark ground
const INK_LIGHT = "#1c2228";  // strokes on light ground
const MUTE = "#a7b0ba";

// ── letterforms ──────────────────────────────────────────────────────────────
// Grid: baseline y=200, x-height 100..200, ascender top 62. Stroke 22, round caps.
// Angles are y-down: 0 = right, 90 = down, 180 = left, 270 = up.
const STROKE = 22;

const pt = (cx: number, cy: number, r: number, deg: number): [number, number] =>
  [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)];

function arc(cx: number, cy: number, r: number, from: number, to: number): [number, number][] {
  const steps = Math.max(2, Math.ceil(Math.abs(to - from) / 5));
  return Array.from({ length: steps + 1 }, (_, i) => pt(cx, cy, r, from + ((to - from) * i) / steps));
}

const d = (pts: [number, number][]) =>
  pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("");

interface Letter { width: number; paths: string[] }

const s_: Letter = { width: 78, paths: [
  d([...arc(39, 125, 25, -50, -270), ...arc(39, 175, 25, -90, 128)]),
] };
const l_: Letter = { width: 22, paths: [d([[11, 73], [11, 200]])] };
const v_: Letter = { width: 82, paths: [d([[6, 111], [41, 196], [76, 111]])] };
const e_: Letter = { width: 84, paths: [
  d([[3, 150], [81, 150]]),
  d(arc(42, 150, 39, 0, -300)),
] };
const n_: Letter = { width: 80, paths: [
  d([[11, 111], [11, 200]]),
  d([...arc(40, 140, 29, 180, 360), [69, 200]]),
] };
const t_: Letter = { width: 58, paths: [
  d([[26, 73], [26, 196]]),
  d([[2, 116], [54, 116]]),
] };

// ── the mark: a vessel filled to its line ────────────────────────────────────
// Ring weight equals the letter stroke, so the vessel sits in the word as an "o".
// The liquid fills the lower half of the cavity, flush to the hull; its surface is
// a slightly brighter chord. R is the outer radius of the hull.
function mark(cx: number, cy: number, R: number, ink: string) {
  const ringW = (STROKE / 50) * R * 0.82; // a touch lighter than the letters, opening the cavity
  const ringR = R - ringW / 2;
  const fillR = ringR - ringW / 2 + 0.6; // flush against the hull (tiny overlap, hull drawn on top)
  const lineW = R * 0.11;
  const chord = fillR - lineW * 0.4;
  const half = d(arc(cx, cy, fillR, 0, 180)) + "Z"; // lower half-disc
  return `
  <path d="${half}" fill="${GREEN}"/>
  <line x1="${(cx - chord).toFixed(1)}" y1="${cy}" x2="${(cx + chord).toFixed(1)}" y2="${cy}"
    stroke="#7ee6c0" stroke-width="${lineW.toFixed(1)}" stroke-linecap="round"/>
  <circle cx="${cx}" cy="${cy}" r="${ringR.toFixed(1)}" fill="none" stroke="${ink}" stroke-width="${ringW.toFixed(1)}"/>`;
}

// ── wordmark assembly ────────────────────────────────────────────────────────
const GAP = 30;
const O_W = 100;
const SEQ: (Letter | "mark")[] = [s_, "mark", l_, v_, e_, n_, t_];
const WORD_W = SEQ.reduce((a, x) => a + (x === "mark" ? O_W : x.width), 0) + GAP * (SEQ.length - 1);

function wordmark(ink: string): string {
  let x = 0;
  const parts: string[] = [];
  for (const item of SEQ) {
    if (item === "mark") {
      parts.push(mark(x + O_W / 2, 150, O_W / 2, ink));
      x += O_W + GAP;
    } else {
      for (const p of item.paths)
        parts.push(`  <path transform="translate(${x} 0)" d="${p}" fill="none" stroke="${ink}" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round"/>`);
      x += item.width + GAP;
    }
  }
  return parts.join("\n");
}

function logoSvg(ink: string): string {
  const pad = 28;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${62 - pad} ${WORD_W + pad * 2} ${200 - 62 + pad * 2}">
${wordmark(ink)}
</svg>\n`;
}

writeFileSync(resolve(OUT, "logo-dark.svg"), logoSvg(INK_DARK));
writeFileSync(resolve(OUT, "logo-light.svg"), logoSvg(INK_LIGHT));

// ── icon ─────────────────────────────────────────────────────────────────────
// the icon carries its own graphite tile so the hull survives any background
const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="28" fill="#14181c"/>
${mark(64, 64, 42, INK_DARK)}
</svg>\n`;
writeFileSync(resolve(OUT, "icon.svg"), icon);

// ── banner ───────────────────────────────────────────────────────────────────
// 1280x320. The mark's level line becomes a waterline across the whole panel:
// everything below it is backed, and the panel only "quotes" what sits below.
const BW = 1280, BH = 320;
const SCALE = 0.62;
const wx = (BW - WORD_W * SCALE) / 2;
const WATER = 42 + 150 * SCALE; // waterline through the mark's centre
const banner = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BW} ${BH}" role="img" aria-label="Solvent">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#161b20"/>
      <stop offset="1" stop-color="#12161a"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.52" r="0.55">
      <stop offset="0" stop-color="${GREEN}" stop-opacity="0.07"/>
      <stop offset="1" stop-color="${GREEN}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${BW}" height="${BH}" rx="10" fill="url(#bg)"/>
  <rect width="${BW}" height="${BH}" rx="10" fill="url(#glow)"/>
  <clipPath id="clip"><rect width="${BW}" height="${BH}" rx="10"/></clipPath>
  <g clip-path="url(#clip)">
    <rect x="0" y="${WATER.toFixed(1)}" width="${BW}" height="${(BH - WATER).toFixed(1)}" fill="${GREEN}" opacity="0.035"/>
    <line x1="0" y1="${WATER.toFixed(1)}" x2="${BW}" y2="${WATER.toFixed(1)}" stroke="${GREEN}" stroke-width="1.4" opacity="0.28"/>
  </g>
  <g transform="translate(${wx.toFixed(1)} 42) scale(${SCALE})">
${wordmark(INK_DARK)}
  </g>
  <text x="${BW / 2}" y="272" text-anchor="middle"
    font-family="ui-monospace, 'SF Mono', 'Cascadia Mono', 'Roboto Mono', Menlo, monospace"
    font-size="16.5" letter-spacing="0.04em" fill="${MUTE}">On-chain market making that never quotes more than it can settle.</text>
</svg>\n`;
writeFileSync(resolve(OUT, "banner.svg"), banner);

console.log(`  → docs/graphics/{logo-dark,logo-light,icon,banner}.svg  (wordmark ${WORD_W}u wide)`);
