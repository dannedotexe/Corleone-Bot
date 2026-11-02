import test from "node:test";
import assert from "node:assert/strict";
import { testDb } from "./helpers.js";
import { createFinance } from "../src/services/finance.js";
import { createPushService, runPushNotifications, sendPush, vapidKeys } from "../src/push.js";

const G = "10000000000000001", A = "30000000000000001", B = "30000000000000002";
const sub = n => ({ endpoint: `https://push.example/${n}`, keys: { p256dh: "BPk" + n, auth: "au" + n } });

test("Push: Abo pro Gerät, Arten abschaltbar, Doppelte verhindert, abgelaufene Abos entfernt", async () => {
  const db = testDb(), push = createPushService(db), sent = [];
  const send = async (s, payload) => { if (s.endpoint.endsWith("/gone")) throw Object.assign(new Error("gone"), { statusCode: 410 }); sent.push([s.endpoint, JSON.parse(payload)]); };
  assert.ok(vapidKeys(db, G).publicKey, "Schlüssel wird einmal erzeugt");
  assert.equal(vapidKeys(db, G).publicKey, vapidKeys(db, G).publicKey);
  push.subscribe({ guildId: G, userId: A, subscription: sub("a1") });
  push.subscribe({ guildId: G, userId: A, subscription: sub("a2"), prefs: { money: false } });
  push.subscribe({ guildId: G, userId: A, subscription: { endpoint: "https://push.example/gone", keys: { p256dh: "x", auth: "y" } } });
  assert.throws(() => push.subscribe({ guildId: G, userId: A, subscription: { endpoint: "http://unsicher", keys: {} } }), /Ungültig/);
  const config = { DISCORD_GUILD_ID: G };
  assert.equal(await sendPush({ db, config, guildId: G, userId: A, type: "money", payload: { title: "x" }, dedupeKey: "k1", send }), 1, "a2 hat Geld aus, gone fliegt raus");
  assert.equal(await sendPush({ db, config, guildId: G, userId: A, type: "money", payload: { title: "x" }, dedupeKey: "k1", send }), 0, "nur einmal");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM push_subscriptions WHERE endpoint LIKE '%gone'").get().n, 0);
  assert.deepEqual(push.forEndpoint(A, "https://push.example/a2").prefs.money, false);
  assert.equal(push.unsubscribe({ userId: B, endpoint: "https://push.example/a1" }), false, "fremdes Abo nicht löschbar");
});

test("Push: Gutschrift, Sanktion, Event in 15 Min. – erster Lauf setzt nur den Startpunkt", async () => {
  const db = testDb(), push = createPushService(db), finance = createFinance(db), sent = [];
  const send = async (s, payload) => { sent.push(JSON.parse(payload)); };
  push.subscribe({ guildId: G, userId: A, subscription: sub("a") });
  const config = { DISCORD_GUILD_ID: G, TIMEZONE: "Europe/Vienna" }, client = { guilds: { cache: new Map() } };
  const t0 = new Date(Date.now() - 60_000);
  await runPushNotifications({ db, client, config, reference: t0, send });
  finance.credit({ guildId: G, userId: A, actorId: B, cents: 25_000_000, reason: "Event gewonnen", key: "c1" });
  finance.credit({ guildId: G, userId: B, actorId: A, cents: 100, reason: "fremd", key: "c2" });
  finance.sanction({ guildId: G, userId: A, actorId: B, cents: 5_000_000, reason: "Zu spät" });
  const start = new Date(Date.now() + 10 * 60_000).toISOString(), now = new Date().toISOString();
  db.prepare("INSERT INTO events(id,guild_id,name,description,starts_at,location,host_id,status,created_at) VALUES('e1',?,'Bankraub','',?,'Bank',?,'scheduled',?)").run(G, start, B, now);
  db.prepare("INSERT INTO event_participants(event_id,user_id,status,updated_at) VALUES('e1',?,'signed_up',?)").run(A, now);
  await runPushNotifications({ db, client, config, reference: new Date(Date.now() + 1000), send });
  const titles = sent.map(p => p.title);
  assert.ok(titles.some(t => /\+\$250\.000,00 gutgeschrieben/.test(t)), titles.join(" | "));
  assert.ok(titles.some(t => /Sanktion: \$50\.000,00/.test(t)));
  assert.ok(titles.some(t => /Bankraub um/.test(t)));
  assert.ok(!titles.some(t => /\$1,00/.test(t)), "nichts von anderen");
  const before = sent.length;
  await runPushNotifications({ db, client, config, reference: new Date(Date.now() + 2000), send });
  assert.equal(sent.length, before, "Event-Erinnerung nur einmal");
});
