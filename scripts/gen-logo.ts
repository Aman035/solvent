/**
 * Solvent logo: a droplet filled exactly to its line.
 *
 * The droplet is Aqua's world; the horizontal line is the solvency floor; the fill
 * sitting exactly at the line is the product's promise: covered up to the mark, and
 * never quoting past it. Light and dark variants for GitHub's <picture> pattern.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { REPO_ROOT } from "@pof/core";

const GREEN = "#2fbf8f";
const GREEN_BRIGHT = "#3fd39b";

function mark(outline: string) {
  return `
  <defs>
    <clipPath id="below"><rect x="6" y="37" width="52" height="24"/></clipPath>
  </defs>
  <path d="M32 5 C 32 5, 13 28.5, 13 41 A 19 19 0 0 0 51 41 C 51 28.5, 32 5, 32 5 Z"
        fill="none" stroke="${outline}" stroke-width="3.2" stroke-linejoin="round"/>
  <path d="M32 5 C 32 5, 13 28.5, 13 41 A 19 19 0 0 0 51 41 C 51 28.5, 32 5, 32 5 Z"
        fill="${GREEN}" clip-path="url(#below)"/>
  <line x1="14.5" y1="37" x2="49.5" y2="37" stroke="${GREEN_BRIGHT}" stroke-width="2.4"/>`;
}

function lockup(text: string, outline: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 344 64" role="img" aria-label="Solvent">
  <g transform="translate(0,0) scale(0.98)">${mark(outline)}</g>
  <text x="72" y="45" font-family="ui-sans-serif,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif"
        font-size="38" font-weight="650" letter-spacing="-0.5" fill="${text}">Solvent</text>
</svg>`;
}

const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Solvent">${mark("#77828c")}
</svg>`;

writeFileSync(resolve(REPO_ROOT, "docs/graphics/logo-dark.svg"), lockup("#eef1f4", "#8b95a0") + "\n");
writeFileSync(resolve(REPO_ROOT, "docs/graphics/logo-light.svg"), lockup("#1c2126", "#59626c") + "\n");
writeFileSync(resolve(REPO_ROOT, "docs/graphics/icon.svg"), iconSvg + "\n");
console.log("logos written");
