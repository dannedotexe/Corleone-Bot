// Erzeugt assets/emojis/*.png aus Lucide-Icons (ISC-Lizenz) im Corleone-Stil (schwarze Kachel, roter Rand, goldene Symbole).
// Nur für Entwickler: node scripts/build-emojis.mjs <pfad/zu/lucide-static/icons>  (braucht Playwright + Chromium; CHROMIUM=<pfad> optional)
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { EMOJI_SET } from "../src/emoji-set.js";

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT ?? "playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const iconDir = process.argv[2];
const out = path.join(root, "assets/emojis");
const GOLD = "#e9c75a";
const inner = name => fs.readFileSync(path.join(iconDir, `${name}.svg`), "utf8").replace(/<!--[\s\S]*?-->/, "").replace(/^[\s\S]*?<svg[\s\S]*?>/, "").replace(/<\/svg>\s*$/, "");
const tile = (id, glyph) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="128" height="128"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#211a1a"/><stop offset="1" stop-color="#0b0a0a"/></linearGradient></defs><rect x="1" y="1" width="30" height="30" rx="8" fill="url(#${id})" stroke="#8b1e2d" stroke-opacity=".95" stroke-width="1"/>${glyph}</svg>`;
const icons = new Map();
for (const [emoji, [name, icon, color = GOLD]] of Object.entries(EMOJI_SET)) {
  if (icons.has(name)) continue;
  const glyph = icon === "dot" ? `<circle cx="16" cy="16" r="7" fill="${color}"/><circle cx="16" cy="16" r="7" fill="none" stroke="#fff" stroke-opacity=".25"/>`
    : `<g transform="translate(6.5 6.5) scale(.79)" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${inner(icon)}</g>`;
  icons.set(name, tile(`g_${name}`, glyph));
}
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 128, height: 128 } });
for (const [name, svg] of icons) {
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await page.locator("svg").screenshot({ path: path.join(out, `${name}.png`), omitBackground: true });
}
await browser.close();
console.log(`${icons.size} Emojis erzeugt in ${out}`);
