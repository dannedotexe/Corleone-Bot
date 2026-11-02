import test from "node:test";
import assert from "node:assert/strict";
import { testDb } from "./helpers.js";
import { VerifyError, verifyMemberManually } from "../src/manual-verify.js";

const G = "10000000000000001", U = "30000000000000001", V = "30000000000000002", STAFF = "30000000000000009", VERIFIED = "20000000000000007";

test("Manuell verifizieren: Name, Rolle, Speicherung mit Staff als Auslöser, DM; ID-Konflikt und Fehler", async () => {
  const db = testDb(), dms = [], roles = new Set();
  const member = id => ({ id, user: { bot: false }, roles: { cache: roles, add: async r => roles.add(r) }, setNickname: async n => { member.last = n; }, send: async p => dms.push(p) });
  const guild = { id: G, ownerId: "1", members: { fetch: async id => (id === U || id === V ? member(id) : null) } };
  const client = { channels: { fetch: async () => null } };
  const config = { ROLE_VERIFIED: [VERIFIED] };
  const r = await verifyMemberManually({ db, client, config, guild, userId: U, input: { firstName: "tony", lastName: "soprano", ingameId: "#123" }, actorId: STAFF });
  assert.equal(r.data.nickname, "Tony Soprano | 123");
  assert.ok(roles.has(VERIFIED));
  assert.equal(db.prepare("SELECT nickname FROM member_verifications WHERE user_id=?").get(U).nickname, "Tony Soprano | 123");
  const log = db.prepare("SELECT actor_id,details FROM audit_logs WHERE action='member.verified'").get();
  assert.equal(log.actor_id, STAFF); assert.match(log.details, /"manual":true/);
  await new Promise(r => setTimeout(r, 5));
  assert.match(dms[0].embeds[0].data.title, /verifiziert/);
  await assert.rejects(verifyMemberManually({ db, client, config, guild, userId: V, input: { firstName: "Paulie", lastName: "Walnuts", ingameId: "123" }, actorId: STAFF }), e => e instanceof VerifyError && /bereits/.test(e.message), "ID gehört schon jemandem");
  await assert.rejects(verifyMemberManually({ db, client, config, guild, userId: "30000000000000099", input: { firstName: "Paulie", lastName: "Walnuts", ingameId: "456" }, actorId: STAFF }), /nicht \(mehr\) auf dem Server/);
  const again = await verifyMemberManually({ db, client, config, guild, userId: U, input: { firstName: "Tony", lastName: "Romano", ingameId: "123" }, actorId: STAFF });
  assert.equal(again.before.nickname, "Tony Soprano | 123", "Umbenennen bei schon Verifizierten");
});

test("Verifizierungs-Erinnerung: nur nicht Verifizierte, 2× täglich, höchstens N-mal, Vorschau", async () => {
  const { testDb } = await import("./helpers.js");
  const { setSetting } = await import("../src/database.js");
  const { currentSlot, runVerifyReminders, unverifiedMembers, verifyReminderPayload } = await import("../src/verify-reminders.js");
  const G = "10000000000000001", VER = "20000000000000077", PANEL = "60000000000000077";
  const config = { DISCORD_GUILD_ID: G, TIMEZONE: "Europe/Vienna", ROLE_VERIFIED: [VER], CHANNEL_VERIFICATION_PANEL: PANEL, VERIFY_REMINDER_ENABLED: true, VERIFY_REMINDER_TIMES: ["12:00", "19:00"], VERIFY_REMINDER_MAX: 3 };
  const db = testDb(), dms = [];
  const mk = (id, { roles = [], bot = false, joined = Date.parse("2026-10-01T10:00:00Z") } = {}) => ({ id, displayName: `M${id.slice(-2)}`, joinedTimestamp: joined, user: { bot }, roles: { cache: new Map(roles.map(r => [r, true])) }, send: async p => { dms.push({ id, p }); return {}; } });
  const now = new Date("2026-10-26T11:05:00Z"); // 12:05 Wien
  const members = new Map([["30000000000000001", mk("30000000000000001")], ["30000000000000002", mk("30000000000000002", { roles: [VER] })], ["30000000000000003", mk("30000000000000003", { bot: true })], ["30000000000000004", mk("30000000000000004", { joined: now.getTime() - 60_000 })], ["30000000000000005", mk("30000000000000005")]]);
  db.prepare("INSERT INTO member_verifications(guild_id,user_id,ingame_id,first_name,last_name,nickname,verified_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run(G, "30000000000000005", "1", "A", "B", "A B", now.toISOString(), now.toISOString());
  assert.deepEqual(unverifiedMembers({ db, config, members: members.values(), reference: now }).map(m => m.id), ["30000000000000001"], "Rolle, Bot, frisch beigetreten und DB-Verifizierte ausgenommen");
  assert.equal(currentSlot(config, new Date("2026-10-26T10:59:00Z")), null, "vor 12:00 nichts");
  assert.equal(currentSlot(config, now).key, "2026-10-26 12:00");
  assert.equal(currentSlot(config, new Date("2026-10-26T13:30:00Z")), null, "verpasster Termin nur 2 Std. nachgeholt");
  const guild = { name: "Yamamoto", members: { cache: members, fetch: async () => members } };
  const client = { guilds: { cache: new Map([[G, guild]]), fetch: async () => guild } };
  const run = at => runVerifyReminders({ db, client, config, reference: at, wait: async () => {} });
  assert.equal((await run(now)).sent, 1);
  assert.equal(await run(new Date("2026-10-26T11:10:00Z")), null, "gleicher Termin nur einmal");
  await run(new Date("2026-10-26T18:01:00Z")); await run(new Date("2026-10-27T11:01:00Z")); await run(new Date("2026-10-27T18:01:00Z"));
  assert.equal(dms.filter(d => d.id === "30000000000000001").length, 3, "höchstens VERIFY_REMINDER_MAX");
  assert.equal(dms.filter(d => d.id === "30000000000000004").length, 3, "Neue nach der Schonfrist ebenfalls");
  assert.match(dms[0].p.embeds[0].data.footer.text, /Erinnerung 1 von 3/);
  assert.match(dms[0].p.components[0].components[0].data.url, new RegExp(`/channels/${G}/${PANEL}$`));
  setSetting(db, G, "PANEL_VERIFICATION", `${PANEL}:70000000000000001`);
  const preview = verifyReminderPayload({ db, config, name: "Danne", test: true });
  assert.match(preview.embeds[0].data.footer.text, /TEST/);
  assert.match(preview.components[0].components[0].data.url, /\/70000000000000001$/, "Link direkt zum Panel");
});
