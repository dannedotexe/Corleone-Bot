import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const dir = new URL("../dashboard/", import.meta.url).pathname;
const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
const scripts = [...html.matchAll(/<script([^>]*)src="\/assets\/([\w-]+\.js)"[^>]*>/g)].map(m => ({ file: m[2], module: /type="module"/.test(m[1]) }));

test("Website: Seiten-Skripte laufen als Module mit eigenem Scope (keine Namenskollisionen)", () => {
  const core = new Set(["theme.js", "app.js"]);
  for (const s of scripts) if (!core.has(s.file)) assert.ok(s.module, `${s.file} muss als type="module" geladen werden`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "yamamoto-modules-"));
  try {
    for (const s of scripts.filter(s => s.module)) {
      const copy = path.join(tmp, s.file.replace(/\.js$/, ".mjs"));
      fs.copyFileSync(path.join(dir, "assets", s.file), copy);
      execFileSync(process.execPath, ["--check", copy]); // strenger Modus, Modul-Syntax
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
