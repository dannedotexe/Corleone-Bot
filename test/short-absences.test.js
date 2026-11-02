import test from "node:test";
import assert from "node:assert/strict";
import { testDb } from "./helpers.js";
import { createShortAbsenceService, parseShortUntil } from "../src/services/short-absences.js";
import { AbsenceError, createAbsenceService } from "../src/services/absences.js";
import { removeAbsencePost, updateAbsenceList } from "../src/absence-posts.js";
import { setSetting } from "../src/database.js";
import { buildAbsencePanelPayload, buildCommands } from "../src/commands.js";

const TZ = "Europe/Vienna", ref = new Date("2026-10-20T17:00:00Z"); // 19:00 Wien
const G = "10000000000000001", U = "30000000000000001";
const iso = d => d.toISOString();

test("Dauer verstehen: Minuten, Stunden, Uhrzeit; Grenzen", () => {
  assert.equal(iso(parseShortUntil("30", TZ, ref)), "2026-10-20T17:30:00.000Z");
  assert.equal(iso(parseShortUntil("30 min", TZ, ref)), "2026-10-20T17:30:00.000Z");
  assert.equal(iso(parseShortUntil("45m", TZ, ref)), "2026-10-20T17:45:00.000Z");
  assert.equal(iso(parseShortUntil("2h", TZ, ref)), "2026-10-20T19:00:00.000Z");
  assert.equal(iso(parseShortUntil("2 Std", TZ, ref)), "2026-10-20T19:00:00.000Z");
  assert.equal(iso(parseShortUntil("1,5 h", TZ, ref)), "2026-10-20T18:30:00.000Z");
  assert.equal(iso(parseShortUntil("1:30 h", TZ, ref)), "2026-10-20T18:30:00.000Z");
  assert.equal(iso(parseShortUntil("bis 21:30", TZ, ref)), "2026-10-20T19:30:00.000Z");
  assert.equal(iso(parseShortUntil("21 Uhr", TZ, ref)), "2026-10-20T19:00:00.000Z");
  assert.equal(iso(parseShortUntil("bis 01:00", TZ, ref)), "2026-10-20T23:00:00.000Z", "nach Mitternacht = morgen");
  assert.throws(() => parseShortUntil("2 min", TZ, ref), AbsenceError);
  assert.throws(() => parseShortUntil("13h", TZ, ref), /12 Stunden/);
  assert.throws(() => parseShortUntil("irgendwann", TZ, ref), AbsenceError);
});

test("Kurz weg: entschuldigt bei Events in der Zeit, neu melden ersetzt, Wieder da beendet", () => {
  const db = testDb(), short = createShortAbsenceService(db), absences = createAbsenceService(db);
  const { row } = short.create({ guildId: G, userId: U, until: new Date("2026-10-20T19:00:00Z"), reason: "Essen", reference: ref });
  assert.equal(short.activeFor(G, U, ref).id, row.id);
  assert.equal(absences.wasAbsent(G, U, "2026-10-20T18:20:00Z", TZ), true, "Event um 20:20 Wien entschuldigt");
  assert.equal(absences.wasAbsent(G, U, "2026-10-20T19:30:00Z", TZ), false, "danach nicht");
  const second = short.create({ guildId: G, userId: U, until: new Date("2026-10-20T18:00:00Z"), reference: new Date("2026-10-20T17:10:00Z") });
  assert.equal(second.previous.id, row.id, "verkürzt = alter Eintrag beendet");
  assert.equal(short.active(G, new Date("2026-10-20T17:20:00Z")).length, 1);
  const ended = short.end({ guildId: G, userId: U, reference: new Date("2026-10-20T17:30:00Z") });
  assert.ok(ended);
  assert.equal(short.activeFor(G, U, new Date("2026-10-20T17:31:00Z")), null);
  assert.equal(absences.wasAbsent(G, U, "2026-10-20T17:45:00Z", TZ), false, "nach „Wieder da“ nicht mehr entschuldigt");
  assert.equal(absences.wasAbsent(G, U, "2026-10-20T17:20:00Z", TZ), true, "vorher schon");
});

test("Abmeldungsliste unter dem Panel: laufend, kurz weg, geplant; bearbeitet nur bei Änderungen; Panel-Button", async () => {
  const db = testDb(), absences = createAbsenceService(db), short = createShortAbsenceService(db), sent = [], edits = [], deleted = [];
  let n = 100;
  const messages = new Map();
  const channel = { id: "60000000000000001",
    send: async p => { const m = { id: String(++n), edit: async q => edits.push(q), delete: async () => { deleted.push(m.id); messages.delete(m.id); } }; messages.set(m.id, m); sent.push(p); return m; },
    messages: { fetch: async id => { if (messages.has(id)) return messages.get(id); throw Object.assign(new Error("gone"), { code: 10008 }); } } };
  const client = { channels: { fetch: async () => channel } };
  const config = { DISCORD_GUILD_ID: G, CHANNEL_ABSENCES: channel.id, TIMEZONE: TZ, ABSENCE_SHOW_REASON: false };
  const now = new Date();
  const day = offset => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(now.getTime() + offset * 86_400_000));
  setSetting(db, G, "PANEL_ABSENCE", `${channel.id}:50`);

  await updateAbsenceList({ db, client, config });
  assert.match(sent[0].embeds[0].data.description, /niemand abgemeldet/);
  const row = absences.create({ guildId: G, userId: U, actorId: U, startsOn: day(0), endsOn: day(3), reason: "Urlaub", timezone: TZ, maxDays: 30 });
  absences.create({ guildId: G, userId: "30000000000000002", actorId: U, startsOn: day(5), endsOn: day(6), reason: "Arbeit", timezone: TZ, maxDays: 30 });
  short.create({ guildId: G, userId: "30000000000000003", until: new Date(now.getTime() + 30 * 60_000), reason: "Essen" });
  await updateAbsenceList({ db, client, config });
  assert.equal(sent.length, 1, "bestehende Liste wird bearbeitet");
  const text = edits.at(-1).embeds[0].data.description;
  assert.match(text, /Abgemeldet \(1\)[\s\S]*<@30000000000000001>/);
  assert.match(text, /Kurz weg \(1\)[\s\S]*<@30000000000000003>/);
  assert.match(text, /Geplant \(1\)[\s\S]*<@30000000000000002>/);
  assert.doesNotMatch(text, /Urlaub/, "Grund nur mit Einstellung");
  await updateAbsenceList({ db, client, config });
  assert.equal(edits.length, 1, "ohne Änderung kein Bearbeiten");
  absences.end({ guildId: G, absenceId: row.id, actorId: U });
  await removeAbsencePost({ db, client, config, row });
  assert.doesNotMatch(edits.at(-1).embeds[0].data.description, /<@30000000000000001>/, "wieder da = aus der Liste");

  // Panel neu gepostet (liegt jetzt unter der Liste) → Liste neu darunter.
  setSetting(db, G, "PANEL_ABSENCE", `${channel.id}:500`);
  n = 600;
  await updateAbsenceList({ db, client, config });
  assert.deepEqual(deleted, ["101"]);
  assert.equal(sent.length, 2);
  assert.ok(buildAbsencePanelPayload().components[0].components.some(b => b.data.custom_id === "absence:short"));
  assert.ok(buildCommands().find(c => c.name === "abwesend").options.some(o => o.name === "kurz"));
});

