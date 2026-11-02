import test from "node:test";
import assert from "node:assert/strict";
import { testDb } from "./helpers.js";
import { loadConfig } from "../src/config.js";
import { buildSuggestionPanelPayload, handleSuggestionInteraction } from "../src/suggestions.js";

const G = "10000000000000001", U = "30000000000000001", V = "30000000000000002", STAFF_ROLE = "20000000000000002", CH = "60000000000000077";

test("Bot-Vorschläge: Panel, Einreichen (Karte + Thread + Panel nach unten), Abstimmen, Team-Status mit DM, Tageslimit", async () => {
  const db = testDb(), sent = [], deleted = [], dms = [], edits = [];
  const config = { ...loadConfig({ DISCORD_TOKEN: "x", DISCORD_CLIENT_ID: "12345678901234567", DISCORD_GUILD_ID: G, ROLE_STAFF: STAFF_ROLE }), CHANNEL_BOT_SUGGESTIONS: CH };
  db.prepare("INSERT INTO guild_settings(guild_id,key,value,updated_at) VALUES(?,?,?,?)").run(G, "PANEL_BOT_SUGGESTIONS", `${CH}:panel0`, "x");
  const channel = { id: CH, send: async p => { const m = { id: `m${sent.length + 1}`, url: `https://discord.com/x/${sent.length + 1}`, startThread: async o => { m.thread = o.name; } }; sent.push({ p, m }); return m; },
    messages: { fetch: async id => ({ id, delete: async () => deleted.push(id), edit: async p => edits.push(p) }) } };
  const client = { channels: { fetch: async id => (id === CH ? channel : null) }, users: { fetch: async id => ({ send: async p => dms.push([id, p.embeds[0].data.title]) }) } };
  const i = (customId, { user = U, roles = [], fields = {} } = {}) => { const out = {}; return { out, customId, guildId: G, user: { id: user }, client, channel, member: { roles: { cache: new Map(roles.map(r => [r, true])) } }, fields: { getTextInputValue: k => fields[k] ?? "" }, reply: async p => { out.reply = p; }, update: async p => { out.update = p; }, showModal: async m => { out.modal = m; } }; };
  assert.equal(buildSuggestionPanelPayload().components.length, 0, "keine Knöpfe mehr");
  assert.match(buildSuggestionPanelPayload().embeds[0].data.description, /einfach als Nachricht/);
  const open = i("sug:new:idea");
  await handleSuggestionInteraction({ i: open, db, client, config });
  assert.equal(open.out.modal.data.custom_id, "sug:submit:idea");
  const submit = i("sug:submit:idea", { fields: { title: "Geburtstagsgrüße", text: "Der Bot könnte am Geburtstag gratulieren." } });
  await handleSuggestionInteraction({ i: submit, db, client, config });
  assert.match(submit.out.reply.content, /Danke/);
  assert.equal(sent[0].p.embeds[0].data.title, "💡 Vorschlag #1");
  assert.match(sent[0].p.embeds[0].data.description, /> \*\*Geburtstagsgrüße\*\*/);
  assert.equal(sent[0].m.thread, "Diskussion über den Vorschlag von Mitglied");
  assert.deepEqual(deleted, ["panel0"], "altes Panel weg"); assert.match(sent[1].p.embeds[0].data.author.name, /BOT-VORSCHLÄGE/, "Panel neu unten");
  const id = db.prepare("SELECT id FROM suggestions").get().id;
  const up = i(`sug:up:${id}`, { user: V });
  await handleSuggestionInteraction({ i: up, db, client, config });
  assert.match(up.out.update.embeds[0].data.description, /🟢 \*\*Dafür:\*\* 1/);
  const again = i(`sug:up:${id}`, { user: V });
  await handleSuggestionInteraction({ i: again, db, client, config });
  assert.match(again.out.update.embeds[0].data.description, /🟢 \*\*Dafür:\*\* 0/, "nochmal = zurückziehen");
  const member = i(`sug:set:${id}:accepted`, { user: V });
  await handleSuggestionInteraction({ i: member, db, client, config });
  assert.match(member.out.reply.content, /nur das Team/);
  const team = i(`sug:setnote:${id}:accepted`, { user: "30000000000000009", roles: [STAFF_ROLE], fields: { note: "Kommt nächste Woche" } });
  await handleSuggestionInteraction({ i: team, db, client, config });
  assert.equal(db.prepare("SELECT status FROM suggestions").get().status, "accepted");
  assert.match(edits.at(-1).embeds[0].data.description, /Antwort vom Team[\s\S]*> Kommt nächste Woche/);
  assert.match(dms[0][1], /Angenommen/);
  for (let n = 0; n < 4; n++) await handleSuggestionInteraction({ i: i("sug:submit:change", { fields: { title: `Idee ${n}`, text: "Beschreibung lang genug" } }), db, client, config });
  const limit = i("sug:submit:change", { fields: { title: "Noch eine", text: "Beschreibung lang genug" } });
  await handleSuggestionInteraction({ i: limit, db, client, config });
  assert.match(limit.out.reply.content, /schon 5 Vorschläge/);
});

test("Vorschlag einfach als Nachricht: wird zur Karte (#2 nach #1), Original weg, zu kurz → Hinweis", async () => {
  const { handleSuggestionMessage } = await import("../src/suggestions.js");
  const db = testDb(), sent = [];
  const config = { ...loadConfig({ DISCORD_TOKEN: "x", DISCORD_CLIENT_ID: "12345678901234567", DISCORD_GUILD_ID: G }), CHANNEL_BOT_SUGGESTIONS: CH };
  const channel = { id: CH, send: async p => { sent.push(p); return { id: `m${sent.length}`, startThread: async () => {}, delete: async () => {} }; }, messages: { fetch: async () => null } };
  const msg = (content, id) => { const m = { id, guildId: G, channelId: CH, channel, content, author: { id: U, username: "tony", displayAvatarURL: () => "https://cdn/avatar.png" }, attachments: new Map(), deleted: false }; m.delete = async () => { m.deleted = true; }; return m; };
  await handleSuggestionMessage({ db, config, message: msg("Erste Idee mit genug Text", "a") });
  const m2 = msg("Event-Erinnerung 1 Std. vorher\nDann vergisst niemand das Event.", "b");
  assert.equal(await handleSuggestionMessage({ db, config, message: m2 }), true);
  assert.ok(m2.deleted, "Original gelöscht");
  const card = sent.find(p => p.embeds?.[0]?.data?.title === "💡 Vorschlag #2");
  assert.ok(card, "nummeriert");
  assert.match(card.embeds[0].data.description, /> \*\*Event-Erinnerung 1 Std\. vorher\*\*\n> Dann vergisst niemand/);
  assert.equal(card.embeds[0].data.thumbnail.url, "https://cdn/avatar.png");
  const short = msg("hi", "c");
  await handleSuggestionMessage({ db, config, message: short });
  assert.ok(short.deleted); assert.match(sent.at(-1).content, /genauer/);
  assert.equal(await handleSuggestionMessage({ db, config: { ...config, CHANNEL_BOT_SUGGESTIONS: "999" }, message: msg("anderer Channel bleibt", "d") }), false);
});

test("Vorschlag löschen: Karte, Thread, Stimmen weg; Nummerierung startet danach wieder bei 1", async () => {
  const { deleteSuggestion, handleSuggestionMessage, suggestionById } = await import("../src/suggestions.js");
  const db = testDb(), deleted = [], sent = [];
  const config = { ...loadConfig({ DISCORD_TOKEN: "x", DISCORD_CLIENT_ID: "12345678901234567", DISCORD_GUILD_ID: G }), CHANNEL_BOT_SUGGESTIONS: CH };
  const channel = { id: CH, send: async p => { sent.push(p); return { id: `m${sent.length}`, startThread: async () => {} }; }, messages: { fetch: async id => ({ id, delete: async () => deleted.push(`msg:${id}`) }) } };
  const client = { channels: { fetch: async id => (id === CH ? channel : { id, delete: async () => deleted.push(`thread:${id}`) }) } };
  const msg = (content, id) => ({ id, guildId: G, channelId: CH, channel, content, author: { id: U, username: "t" }, attachments: new Map(), delete: async () => {} });
  await handleSuggestionMessage({ db, config, message: msg("Test-Vorschlag Nummer eins", "a") });
  const row = db.prepare("SELECT * FROM suggestions").get();
  db.prepare("INSERT INTO suggestion_votes VALUES(?,?,1,'x')").run(row.id, V);
  await deleteSuggestion({ db, client, row, actorId: "x" });
  assert.equal(suggestionById(db, row.id), undefined);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM suggestion_votes").get().n, 0);
  assert.deepEqual(deleted.sort(), [`msg:${row.message_id}`, `thread:${row.message_id}`].sort());
  await handleSuggestionMessage({ db, config, message: msg("Erster echter Vorschlag hier", "b") });
  assert.equal(db.prepare("SELECT number FROM suggestions").get().number, 1, "fängt wieder bei 1 an");
});
