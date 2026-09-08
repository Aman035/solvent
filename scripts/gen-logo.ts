/**
 * The Solvent brand, generated: wordmark, icon, banner.
 *
 * The wordmark is IBM Plex Sans SemiBold (OFL-1.1), embedded as extracted outlines
 * (scripts/brand-glyphs.json, via fonttools) so it renders identically everywhere.
 * The "o" is replaced by the mark: a vessel filled to its line - ships carry the same
 * mark on their hulls; load past the line and you sink. The banner extends that line
 * into a waterline across the panel.
 *
 * Outputs docs/graphics/{logo-dark,logo-light,icon,banner}.svg
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "../docs/graphics");
mkdirSync(OUT, { recursive: true });

const GREEN = "#3fd39b";
const MENISCUS = "#8beacb";
const INK_DARK = "#eef1f4";
const INK_LIGHT = "#1c2228";
const MUTE = "#8b95a1";

interface Glyph { ch: string; x: number; adv: number; path: string }
interface Word { unitsPerEm: number; width: number; glyphs: Glyph[] }
const B = JSON.parse(readFileSync(resolve(HERE, "brand-glyphs.json"), "utf8")) as {
  word: Word; tagline: Word; oBounds: [number, number, number, number];
};

// ── the mark: a vessel filled to its line ────────────────────────────────────
function mark(cx: number, cy: number, R: number, ink: string, ringW: number) {
  const ringR = R - ringW / 2;
  const fillR = ringR - ringW / 2 + R * 0.015;
  const lineW = R * 0.1;
  const chord = fillR - lineW * 0.4;
  const steps = 48;
  const half = Array.from({ length: steps + 1 }, (_, i) => {
    const a = (Math.PI * i) / steps;
    return `${i ? "L" : "M"}${(cx + fillR * Math.cos(a)).toFixed(1)} ${(cy + fillR * Math.sin(a)).toFixed(1)}`;
  }).join("") + "Z";
  return `
  <path d="${half}" fill="${GREEN}"/>
  <line x1="${(cx - chord).toFixed(1)}" y1="${cy}" x2="${(cx + chord).toFixed(1)}" y2="${cy}"
    stroke="${MENISCUS}" stroke-width="${lineW.toFixed(1)}" stroke-linecap="round"/>
  <circle cx="${cx}" cy="${cy}" r="${ringR.toFixed(1)}" fill="none" stroke="${ink}" stroke-width="${ringW.toFixed(1)}"/>`;
}

/**
 * Typeset a prepared word at (x, baselineY) and scale, in ink; the "o" (if requested)
 * is left empty and its slot metrics are returned for the mark.
 */
function typeset(w: Word, x: number, baselineY: number, scale: number, ink: string, skipO = false) {
  const parts: string[] = [];
  let oSlot: { cx: number; cy: number; R: number; ringW: number } | null = null;
  for (const g of w.glyphs) {
    if (skipO && g.ch === "o" && !oSlot) {
      const [x0, y0, x1, y1] = B.oBounds;
      oSlot = {
        cx: x + (g.x + (x0 + x1) / 2) * scale,
        cy: baselineY - ((y0 + y1) / 2) * scale,
        R: ((x1 - x0) / 2) * scale,
        ringW: 92 * scale, // Plex SemiBold stem weight, so the vessel sits in the word
      };
      continue;
    }
    parts.push(`  <path transform="translate(${(x + g.x * scale).toFixed(2)} ${baselineY}) scale(${scale} ${-scale})" d="${g.path}" fill="${ink}"/>`);
  }
  return { svg: parts.join("\n"), oSlot };
}

// ── logo (wordmark alone) ────────────────────────────────────────────────────
function logoSvg(ink: string): string {
  const S = 0.16, X = 8, BASE = 100, W = B.word.width * S + 16, H = 128;
  const t = typeset(B.word, X, BASE, S, ink, true);
  const o = t.oSlot!;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(0)} ${H}">
${t.svg}${mark(o.cx, o.cy, o.R, ink, o.ringW)}
</svg>\n`;
}
writeFileSync(resolve(OUT, "logo-dark.svg"), logoSvg(INK_DARK));
writeFileSync(resolve(OUT, "logo-light.svg"), logoSvg(INK_LIGHT));

// ── icon ─────────────────────────────────────────────────────────────────────
writeFileSync(resolve(OUT, "icon.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="28" fill="#14181c"/>
${mark(64, 64, 42, INK_DARK, 15)}
</svg>\n`);

// ── banner ───────────────────────────────────────────────────────────────────
const BW = 1280, BH = 320;
const S = 0.155;
const wordW = B.word.width * S;
const wx = (BW - wordW) / 2;
const t = typeset(B.word, wx, 196, S, INK_DARK, true);
const o = t.oSlot!;
const WATER = o.cy;

const TS = 0.0172;
const tagW = B.tagline.width * TS;
const tag = typeset(B.tagline, (BW - tagW) / 2, 256, TS, MUTE);

const banner = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BW} ${BH}" role="img" aria-label="Solvent">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#171c21"/>
      <stop offset="1" stop-color="#111519"/>
    </linearGradient>
    <linearGradient id="wl" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${GREEN}" stop-opacity="0"/>
      <stop offset="0.18" stop-color="${GREEN}" stop-opacity="0.34"/>
      <stop offset="0.5" stop-color="${GREEN}" stop-opacity="0.5"/>
      <stop offset="0.82" stop-color="${GREEN}" stop-opacity="0.34"/>
      <stop offset="1" stop-color="${GREEN}" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="depth" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${GREEN}" stop-opacity="0.05"/>
      <stop offset="1" stop-color="${GREEN}" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="clip"><rect width="${BW}" height="${BH}" rx="10"/></clipPath>
  </defs>
  <rect width="${BW}" height="${BH}" rx="10" fill="url(#bg)"/>
  <g clip-path="url(#clip)">
    <rect x="0" y="${WATER.toFixed(1)}" width="${BW}" height="${(BH - WATER).toFixed(1)}" fill="url(#depth)"/>
    <rect x="0" y="${(WATER - 0.7).toFixed(1)}" width="${BW}" height="1.4" fill="url(#wl)"/>
  </g>
${t.svg}${mark(o.cx, o.cy, o.R, INK_DARK, o.ringW)}
${tag.svg}
</svg>\n`;
writeFileSync(resolve(OUT, "banner.svg"), banner);
console.log(`  → docs/graphics/{logo-dark,logo-light,icon,banner}.svg  (IBM Plex outlines)`);
