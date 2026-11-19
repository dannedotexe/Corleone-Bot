import test from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits } from "discord.js";
import { mirrorFamilyAccess } from "../src/friend-access.js";

test("Freund-Rolle bekommt genau die Channel-Rechte der Familie, Staff bleibt zu", async () => {
  const FAM = "20000000000000001", FRIEND = "20000000000000002", edits = [];
  const ow = (allow, deny) => ({ allow: { bitfield: allow }, deny: { bitfield: deny } });
  const ch = (id, name, type, overwrites) => [id, { id, name, type, permissionOverwrites: { cache: new Map(overwrites), edit: async (role, flags) => { edits.push([name, role, flags]); } } }];
  const view = PermissionFlagsBits.ViewChannel, send = PermissionFlagsBits.SendMessages, connect = PermissionFlagsBits.Connect;
  const guild = { channels: { fetch: async () => new Map([
    ch("c1", "chat", 0, [[FAM, ow(view | send, 0n)]]),
    ch("k1", "FAMILIE", 4, [[FAM, ow(view | connect, 0n)]]),
    ch("s1", "staff", 0, [["99", ow(view, 0n)]]),
  ]) } };
  const r = await mirrorFamilyAccess({ guild, familyRoleId: FAM, friendRoleId: FRIEND });
  assert.equal(r.updated, 2);
  assert.deepEqual(edits.map(e => e[0]), ["FAMILIE", "chat"], "Kategorien zuerst, Staff nicht");
  assert.deepEqual(edits[1][2], { ViewChannel: true, SendMessages: true });
  assert.ok(edits.every(e => e[1] === FRIEND));
  await assert.rejects(mirrorFamilyAccess({ guild, familyRoleId: FAM, friendRoleId: FAM }), /verschieden/);
});

test("Freund-Rolle: Event-/Aufgaben-Bereiche bleiben zu, alte Freund-Rechte dort werden entfernt", async () => {
  const FAM = "20000000000000001", FRIEND = "20000000000000002", edits = [], removed = [];
  const view = PermissionFlagsBits.ViewChannel;
  const ow = (allow, extra = {}) => ({ allow: { bitfield: allow }, deny: { bitfield: 0n }, ...extra });
  const ch = (id, name, type, parentId, overwrites) => [id, { id, name, type, parentId, permissionOverwrites: { cache: new Map(overwrites), edit: async (role) => { edits.push(name); } } }];
  const guild = { channels: { fetch: async () => new Map([
    ch("k1", "🔮・EVENTS", 4, null, [[FAM, ow(view)], [FRIEND, ow(view, { delete: async () => { removed.push("EVENTS"); } })]]),
    ch("c1", "📅・event-infos", 0, "k1", [[FAM, ow(view)]]),
    ch("c2", "💬・chat", 0, null, [[FAM, ow(view)]]),
    ch("c3", "📋・aufgaben", 0, null, [[FAM, ow(view)]]),
  ]) } };
  const r = await mirrorFamilyAccess({ guild, familyRoleId: FAM, friendRoleId: FRIEND });
  assert.deepEqual(edits, ["💬・chat"]);
  assert.deepEqual(removed, ["EVENTS"]);
  assert.deepEqual([r.updated, r.excluded], [1, 3]);
});
