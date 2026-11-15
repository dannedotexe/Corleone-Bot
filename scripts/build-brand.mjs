// Erzeugt die Platzhalter-Markenbilder (App-Icons, Profilbild, Login-Banner) im Corleone-Stil:
// Schwarz, weinrotes Siegel, Gold, Monogramm „C“ in Bodoni Moda (OFL, liegt unter dashboard/assets/fonts).
// Nur für Entwickler: node scripts/build-brand.mjs   (braucht Playwright + Chromium; CHROMIUM=<pfad> optional)
// Eigenes Logo: einfach die erzeugten Dateien in dashboard/assets/ ersetzen (gleiche Namen und Größen).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? "playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assets = path.join(root, "dashboard/assets");
const font = fs.readFileSync(path.join(assets, "fonts/bodoni-moda.woff2")).toString("base64");
const RED = "#8b1e2d", GOLD = "#c9a24b", INK = "#0b0a0a", IVORY = "#f2ece4";

const css = `@font-face{font-family:B;src:url(data:font/woff2;base64,${font}) format("woff2");font-weight:400 900}
html,body{margin:0;background:transparent}`;
// Quadratisches Zeichen: Siegel mit Monogramm. pad = Sicherheitsrand (maskable braucht ~20 %).
const mark = (size, pad = 0.12, rounded = true) => {
  const s = size * (1 - 2 * pad);
  return `<div style="width:${size}px;height:${size}px;background:${INK};display:grid;place-items:center;${rounded ? `border-radius:${size * 0.22}px;` : ""}overflow:hidden">
    <div style="width:${s}px;height:${s}px;border-radius:${s * 0.2}px;background:radial-gradient(120% 120% at 30% 20%,#a8293b,${RED} 55%,#4f0f19);
      box-shadow:inset 0 0 0 ${Math.max(1, s * 0.025)}px ${GOLD};display:grid;place-items:center">
      <span style="font-family:B;font-weight:700;font-size:${s * 0.72}px;line-height:1;color:#e8c97f;transform:translateY(${s * 0.02}px)">C</span>
    </div></div>`;
};
const banner = (w, h) => `<div style="width:${w}px;height:${h}px;background:radial-gradient(80% 90% at 50% 40%,#1d1515,${INK});display:grid;place-items:center">
  <div style="display:grid;justify-items:center;gap:${h * 0.05}px">
    ${mark(h * 0.42, 0.06, true)}
    <div style="font-family:B;font-weight:600;font-size:${h * 0.13}px;letter-spacing:.22em;color:${IVORY};padding-left:.22em">CORLEONE</div>
    <div style="width:${w * 0.16}px;height:2px;background:${GOLD};opacity:.8"></div>
  </div></div>`;

const jobs = [
  ["icons/icon-192.png", 192, 192, mark(192, 0.1, false)],
  ["icons/icon-512.png", 512, 512, mark(512, 0.1, false)],
  ["icons/maskable-512.png", 512, 512, mark(512, 0.2, false)],
  ["icons/apple-touch-icon.png", 180, 180, mark(180, 0.1, false)],
  ["corleone-profile.png", 256, 256, mark(256, 0.1, true)],
  ["corleone-banner.png", 960, 540, banner(960, 540)],
];
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
for (const [file, w, h, html] of jobs) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.setContent(`<html><head><style>${css}</style></head><body>${html}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(assets, file), omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
  await page.close();
}
await browser.close();
console.log(`${jobs.length} Markenbilder erzeugt in ${assets}`);
