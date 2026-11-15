import test from "node:test";
import assert from "node:assert/strict";
import { ChannelType } from "discord.js";
import { applyBlueprint, captureBlueprint, copyJob } from "../src/server-copy.js";

const perm = n => ({ bitfield: BigInt(n), has: () => true });
function sourceGuild() {
  const id = "100000000000000001";
  const roles = new Map([
    [id, { id, name: "@everyone", position: 0, managed: false, color: 0, hoist: false, mentionable: false, permissions: perm(1024) }],
    ["r1", { id: "r1", name: "Leitung", position: 3, managed: false, color: 0xff0000, hoist: true, mentionable: false, permissions: perm(8) }],
    ["r2", { id: "r2", name: "Mitglied", position: 2, managed: false, color: 0, hoist: false, mentionable: true, permissions: perm(1024) }],
    ["r3", { id: "r3", name: "Nexus Helper", position: 4, managed: true, color: 0, hoist: false, mentionable: false, permissions: perm(8) }],
  ]);
  const ow = (oid, allow, deny) => ({ id: oid, type: 0, allow: { bitfield: BigInt(allow) }, deny: { bitfield: BigInt(deny) } });
  const cat = { id: "c1", name: "FAMILIE", type: ChannelType.GuildCategory, rawPosition: 0, permissionOverwrites: { cache: new Map([["x", ow(id, 0, 1024)], ["y", ow("r2", 1024, 0)]]) } };
  const chans = new Map([
    ["c1", cat],
    ["t1", { id: "t1", name: "chat", type: ChannelType.GuildText, rawPosition: 0, parent: cat, topic: "Hallo", rateLimitPerUser: 5, permissionOverwrites: { cache: new Map() } }],
    ["a1", { id: "a1", name: "news", type: ChannelType.GuildAnnouncement, rawPosition: 1, parent: cat, permissionOverwrites: { cache: new Map() } }],
  ]);
  return { id, name: "Nexus", roles: { fetch: async () => roles }, channels: { fetch: async () => chans } };
}
function targetGuild() {
  const created = { roles: [], channels: [] }; let n = 0;
  const g = {
    id: "200000000000000001", name: "Neu", created,
    members: { me: { permissions: { has: () => true } } },
    roles: { fetch: async () => new Map(), everyone: { setPermissions: async p => { created.everyone = p; } }, create: async o => { created.roles.push(o); return { id: `nr${++n}` }; } },
    channels: { fetch: async () => new Map(), create: async o => { if (o.type === ChannelType.GuildAnnouncement) throw new Error("community only"); created.channels.push(o); return { id: `nc${++n}` }; } },
  };
  return g;
}

test("Server kopieren: Rollen von oben nach unten, Rechte umgeschlüsselt, Bot-Rollen ausgelassen", async () => {
  const target = targetGuild();
  applyBlueprint({ blueprint: await captureBlueprint(sourceGuild()), targetGuild: target });
  assert.throws(() => applyBlueprint({ blueprint: { format: "x" }, targetGuild: { id: "z" } }), /keine gültige/);
  for (let i = 0; i < 50 && copyJob(target.id)?.status === "running"; i++) await new Promise(r => setTimeout(r, 10));
  const job = copyJob(target.id);
  assert.equal(job.status, "done", job.step);
  assert.deepEqual(target.created.roles.map(r => r.name), ["Leitung", "Mitglied"]);
  assert.equal(target.created.everyone, 1024n);
  const [category, chat, news] = target.created.channels;
  assert.equal(category.name, "FAMILIE");
  assert.deepEqual(category.permissionOverwrites.map(o => [o.id, o.allow, o.deny]), [[target.id, 0n, 1024n], ["nr2", 1024n, 0n]]);
  assert.equal(chat.parent, "nc3"); assert.equal(chat.topic, "Hallo"); assert.equal(chat.rateLimitPerUser, 5);
  assert.equal(news.type, ChannelType.GuildText, "Ankündigungs-Channel ohne Community als Text-Channel");
  assert.deepEqual(job.created, { roles: 2, categories: 1, channels: 2 });
});
