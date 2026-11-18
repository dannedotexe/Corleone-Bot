import test from "node:test";
import assert from "node:assert/strict";
import { applyRankNames, parseRankNames } from "../src/rank-names.js";

test("Rang-Namen: umbenennen, fehlenden Rang anlegen, Mehrdeutiges nur melden", async () => {
  const G = "10000000000000001";
  const created = [];
  const role = (id, name, position) => ({ id, name, position, color: 1, hoist: true, managed: false, setName: async n => { role.renamed.push([id, n]); }, setPosition: async () => {} });
  role.renamed = [];
  const roles = new Map([[G, { id: G, name: "@everyone", managed: false }],
    ["r10", role("r10", "| 10 - Boss", 10)], ["r9", role("r9", "| 9 - JEFE", 9)], ["r2", role("r2", "| 2 - Proberang", 2)],
    ["x", { id: "x", name: "Corleone Bot", managed: true }]]);
  const guild = { id: G, roles: { fetch: async () => roles, create: async o => { created.push(o); return { id: `n${created.length}`, ...o, setPosition: async () => {} }; } } };
  const config = { RANK_NAMES: ["10=EL PATRON", "9=JEFE", "2=NOVIZIO", "1=CENSORE"], RANK_ROLES_JSON: [] };
  const r = await applyRankNames({ guild, config, actorId: "u" });
  assert.deepEqual(role.renamed, [["r10", "| 10 - EL PATRON"], ["r2", "| 2 - NOVIZIO"]]);
  assert.deepEqual(created.map(c => [c.name, c.permissions]), [["| 1 - CENSORE", 0n]]);
  assert.deepEqual([r.renamed, r.created], [2, 1]);
  assert.equal(parseRankNames(["x", "3 = PICCIOTTO"]).get(3), "PICCIOTTO");
});
