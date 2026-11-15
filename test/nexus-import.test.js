import test from "node:test";
import assert from "node:assert/strict";
import { ChannelType } from "discord.js";
import { testDb } from "./helpers.js";
import { loadConfig } from "../src/config.js";
import { createSettingsService } from "../src/services/settings.js";
import { createTextsService, panelTexts } from "../src/services/texts.js";
import { applySettingsImport, previewBlueprint, renameFamily, resolveSettingsImport } from "../src/nexus-import.js";

const G = "10000000000000001";
const env = { DISCORD_TOKEN: "test-only", DISCORD_CLIENT_ID: "12345678901234567", DISCORD_GUILD_ID: G, ROLE_LEADERS: "20000000000000001" };

function corleoneGuild() {
  const roles = new Map([
    [G, { id: G, name: "@everyone", managed: false }],
    ["20000000000000001", { id: "20000000000000001", name: "Leitung", managed: false }],
    ["20000000000000002", { id: "20000000000000002", name: "| Corleone", managed: false }],
    ["20000000000000003", { id: "20000000000000003", name: "Doppelt", managed: false }],
    ["20000000000000004", { id: "20000000000000004", name: "Doppelt", managed: false }],
    ["20000000000000005", { id: "20000000000000005", name: "| 8 - Leaderschaft", managed: false }],
  ]);
  const ch = (id, name, type, parentId = null) => [id, { id, name, type, parentId }];
  const channels = new Map([
    ch("60000000000000001", "FAMILIE", ChannelType.GuildCategory),
    ch("60000000000000002", "INFO", ChannelType.GuildCategory),
    ch("60000000000000003", "abmeldungen", ChannelType.GuildText, "60000000000000001"),
    ch("60000000000000004", "chat", ChannelType.GuildText, "60000000000000001"),
    ch("60000000000000005", "chat", ChannelType.GuildText, "60000000000000002"),
    ch("60000000000000006", "aufgaben-logs", ChannelType.GuildForum, "60000000000000001"),
    ch("60000000000000007", "TICKETS", ChannelType.GuildCategory),
  ]);
  return { id: G, roles: { fetch: async () => roles }, channels: { fetch: async () => channels } };
}

const file = {
  format: "nexus-settings-v1", source: "Nexus", exportedAt: "2026-11-12T00:00:00Z",
  settings: {
    CHANNEL_ABSENCES: { channel: { name: "abmeldungen", category: "FAMILIE" } },
    CHANNEL_WELCOME: { channel: { name: "chat", category: "INFO" } },
    CHANNEL_TICKET_LOG: { channel: { name: "gibt-es-nicht", category: null } },
    CHANNEL_TICKET_CATEGORY: { channel: { name: "TICKETS", category: null } },
    CHANNEL_TASK_FORUM: { channel: { name: "aufgaben-logs", category: "FAMILIE" } },
    ROLE_MEMBERS: { roles: ["| Nexus"] },
    ROLE_STAFF: { roles: ["Doppelt"] },
    RANK_ROLES_JSON: { ranks: [{ label: "Rang 8", role: "| 8 - Leaderschaft" }, { label: "Rang 9", role: "| 9 - Fehlt" }] },
    PAYOUT_MINIMUM_CENTS: { value: 50000000 },
    ACCOUNT_EXCLUDED_USERS: { value: ["30000000000000001"] },
    TICKET_CATEGORIES_JSON: { value: [{ id: "support", label: "Nexus Support", roleIds: ["99999999999999999"] }] },
    INACTIVITY_DAYS: { value: 21 },
    GIBT_ES_NICHT: { value: 1 },
  },
  texts: { TEXTS_APPLICATION: JSON.stringify({ color: "#123456", title: "Komm zu Nexus", buttonApply: "🤝  Bei den Gambinos bewerben" }) },
};

test("Nexus-Namen werden in Texten durch Corleone ersetzt", () => {
  assert.equal(renameFamily("NEXUS  •  Willkommen bei Nexus und den Gambinos"), "CORLEONE  •  Willkommen bei Corleone und den Corleone");
});

test("Einstellungs-Import: per Name aufgelöst, Unklares nur gelistet, Geld in Cent korrekt, Farben bleiben", async () => {
  const resolved = await resolveSettingsImport({ data: file, guild: corleoneGuild() });
  const byKey = Object.fromEntries(resolved.changes.map(c => [c.key, c]));
  assert.equal(byKey.CHANNEL_ABSENCES.value, "60000000000000003");
  assert.equal(byKey.CHANNEL_WELCOME.value, "60000000000000005", "gleicher Name – Kategorie entscheidet");
  assert.equal(byKey.CHANNEL_TICKET_CATEGORY.value, "60000000000000007");
  assert.equal(byKey.CHANNEL_TASK_FORUM.value, "60000000000000006");
  assert.deepEqual(byKey.ROLE_MEMBERS.value, ["20000000000000002"], "„| Nexus“ → „| Corleone“");
  assert.equal(byKey.ROLE_STAFF, undefined, "doppelte Rolle wird nicht geraten");
  assert.deepEqual(byKey.RANK_ROLES_JSON.value, [{ label: "Rang 8", roleId: "20000000000000005" }]);
  assert.equal(byKey.PAYOUT_MINIMUM_CENTS.value, "500000.00");
  assert.equal(byKey.ACCOUNT_EXCLUDED_USERS, undefined);
  assert.deepEqual(byKey.TICKET_CATEGORIES_JSON.value, [{ id: "support", label: "Corleone Support", roleIds: [] }]);
  const reasons = resolved.missing.map(m => `${m.key}: ${m.reason}`).join("\n");
  for (const expected of [/CHANNEL_TICKET_LOG: „gibt-es-nicht“ nicht gefunden/, /ROLE_STAFF: Rolle „Doppelt“ gibt es mehrfach/, /Rang 9: Rolle/, /ACCOUNT_EXCLUDED_USERS/, /TICKET_CATEGORIES_JSON: zuständige Rollen/, /GIBT_ES_NICHT/]) assert.match(reasons, expected);
  assert.deepEqual(resolved.texts, [{ panel: "application", label: "Bewerbungs-Panel", values: { title: "Komm zu Corleone", buttonApply: "🤝  Bei den Corleone bewerben" } }]);

  const db = testDb(), config = loadConfig(env);
  const settings = createSettingsService({ db, config, env, guildId: G }); settings.apply();
  const result = applySettingsImport({ resolved, settings, textsService: createTextsService(db, G), actorId: "u", actorIsOwner: true });
  assert.deepEqual(result.failed, []);
  assert.equal(config.CHANNEL_ABSENCES, "60000000000000003");
  assert.equal(config.PAYOUT_MINIMUM_CENTS, 50000000, "500.000 $ bleiben 500.000 $");
  assert.equal(config.INACTIVITY_DAYS, 21);
  const texts = panelTexts(db, G, "application");
  assert.equal(texts.title, "Komm zu Corleone");
  assert.equal(texts.color, "#c9a24b", "Corleone-Farbe bleibt");
  assert.ok(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='config.changed'").get().n >= 8, "jede Änderung protokolliert");
});

test("Import: falsche Dateien werden abgelehnt, Aufbau-Vorschau zählt nur Neues", async () => {
  await assert.rejects(resolveSettingsImport({ data: { format: "x" }, guild: corleoneGuild() }), /keine gültige Einstellungs-Datei/);
  await assert.rejects(previewBlueprint({ blueprint: { format: "nexus-settings-v1" }, guild: corleoneGuild() }), /keine gültige Aufbau-Datei/);
  const preview = await previewBlueprint({ guild: corleoneGuild(), blueprint: {
    format: "nexus-blueprint-v1", source: "Nexus",
    roles: [{ name: "Leitung" }, { name: "Neu" }],
    categories: [{ name: "FAMILIE", type: ChannelType.GuildCategory }, { name: "EVENTS", type: ChannelType.GuildCategory }],
    channels: [{ name: "chat", type: ChannelType.GuildText, parent: "FAMILIE" }, { name: "event-log", type: ChannelType.GuildText, parent: "EVENTS" }],
  } });
  assert.deepEqual([preview.roles.create, preview.categories.create, preview.channels.create], [1, 1, 1]);
  assert.equal(preview.confirmWord, "AUFBAUEN");
});
