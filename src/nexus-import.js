import { ChannelType } from "discord.js";
import { SETTINGS } from "./services/settings.js";
import { PANEL_TEXTS } from "./services/texts.js";

/**
 * Import aus dem Nexus-Bot (Website → Status → „Server kopieren“ bzw. „Einstellungen exportieren“).
 *
 * - Aufbau-Datei (nexus-blueprint-v1): Vorschau hier, Einbau über applyBlueprint (server-copy.js).
 * - Einstellungs-Datei (nexus-settings-v1): Channels und Rollen stehen dort mit NAMEN statt IDs. Sie werden auf dem
 *   eigenen Server per Name (und Kategorie) gesucht; nur eindeutige Treffer werden übernommen, alles andere landet in
 *   der Liste „nicht gefunden“ – es wird nie geraten. Gespeichert wird über den normalen Settings-/Texte-Service
 *   (gleiche Prüfung, Audit-Log).
 */
export const BLUEPRINT_FORMAT = "nexus-blueprint-v1";
export const SETTINGS_FORMAT = "nexus-settings-v1";
export const BLUEPRINT_CONFIRM_WORD = "AUFBAUEN";
export const SETTINGS_CONFIRM_WORD = "ÜBERNEHMEN";

// Personenbezogen bzw. nur auf dem Nexus-Server sinnvoll – nie übernehmen.
const SKIP_KEYS = new Map([["ACCOUNT_EXCLUDED_USERS", "enthält Personen vom Nexus-Server – bitte selbst eintragen"]]);

/** Nexus/Gambino-Namen in Texten durch Corleone ersetzen (Groß-/Kleinschreibung bleibt erhalten). */
export function renameFamily(text) {
  return String(text ?? "")
    .replace(/GAMBINOS?|NEXUS/g, "CORLEONE")
    .replace(/Gambinos?|Nexus/g, "Corleone")
    .replace(/gambinos?|nexus/g, "corleone");
}

const norm = value => String(value ?? "").trim().toLowerCase();
const isCategory = c => c.type === ChannelType.GuildCategory;
const isForum = c => c.type === ChannelType.GuildForum;
const isTextLike = c => [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(c.type);

export function validateBlueprint(blueprint) {
  if (blueprint?.format !== BLUEPRINT_FORMAT || !Array.isArray(blueprint.roles) || !Array.isArray(blueprint.channels) || !Array.isArray(blueprint.categories ?? []))
    throw new Error("Das ist keine gültige Aufbau-Datei (nexus-aufbau-….json aus dem Nexus-Bot).");
  return blueprint;
}

/** Zählt, was angelegt und was wiederverwendet würde (gleiche Logik wie applyBlueprint: gleiche Namen bleiben). */
export async function previewBlueprint({ blueprint, guild }) {
  validateBlueprint(blueprint);
  const roles = [...(await guild.roles.fetch()).values()];
  const channels = [...(await guild.channels.fetch()).values()].filter(Boolean);
  const roleNames = new Set(roles.filter(r => !r.managed).map(r => r.name));
  const categoryNames = new Set(channels.filter(isCategory).map(c => c.name));
  const categoryIdByName = new Map(channels.filter(isCategory).map(c => [c.name, c.id]));
  const newRoles = blueprint.roles.filter(r => !roleNames.has(r.name));
  const newCategories = (blueprint.categories ?? []).filter(c => !categoryNames.has(c.name));
  const newChannels = blueprint.channels.filter(c => {
    const parent = c.parent ? categoryIdByName.get(c.parent) ?? null : null;
    return !channels.some(x => x.name === c.name && x.type === c.type && (x.parentId ?? null) === parent);
  });
  return {
    source: String(blueprint.source ?? "Nexus"), capturedAt: blueprint.capturedAt ?? null, confirmWord: BLUEPRINT_CONFIRM_WORD,
    roles: { total: blueprint.roles.length, create: newRoles.length, names: newRoles.slice(0, 40).map(r => r.name) },
    categories: { total: (blueprint.categories ?? []).length, create: newCategories.length, names: newCategories.slice(0, 40).map(c => c.name) },
    channels: { total: blueprint.channels.length, create: newChannels.length },
  };
}

function validateSettingsFile(data) {
  if (data?.format !== SETTINGS_FORMAT || typeof data.settings !== "object" || data.settings === null)
    throw new Error("Das ist keine gültige Einstellungs-Datei (nexus-einstellungen-….json aus dem Nexus-Bot).");
  return data;
}

function panelForTextKey(key) {
  return Object.keys(PANEL_TEXTS).find(panel => `TEXTS_${panel.replace(/[A-Z]/g, c => `_${c}`).toUpperCase()}` === key) ?? null;
}

/**
 * Löst die Einstellungs-Datei gegen den eigenen Server auf. Ergebnis: changes (übernehmbar, mit Website-Wert),
 * missing (nicht eindeutig gefunden / bewusst ausgelassen) und texts (Panel-Texte, Farben bleiben Corleone).
 */
export async function resolveSettingsImport({ data, guild }) {
  validateSettingsFile(data);
  const channels = [...(await guild.channels.fetch()).values()].filter(Boolean);
  const roles = [...(await guild.roles.fetch()).values()].filter(r => r.id !== guild.id && !r.managed);
  const categoryById = new Map(channels.filter(isCategory).map(c => [c.id, c.name]));
  const changes = [], missing = [], texts = [];

  const findChannel = (ref, kind) => {
    if (!ref?.name) return { error: "kein Name in der Datei" };
    const pool = channels.filter(kind === "category" ? isCategory : kind === "forum" ? isForum : isTextLike);
    let hits = pool.filter(c => norm(c.name) === norm(ref.name));
    if (hits.length > 1 && kind !== "category" && ref.category) hits = hits.filter(c => norm(categoryById.get(c.parentId)) === norm(ref.category));
    if (hits.length === 1) return { id: hits[0].id, label: `#${hits[0].name}` };
    return { error: hits.length ? `„${ref.name}“ gibt es mehrfach` : `„${ref.name}“${ref.category ? ` (in ${ref.category})` : ""} nicht gefunden` };
  };
  const findRole = name => {
    const hits = roles.filter(r => norm(r.name) === norm(name));
    return hits.length === 1 ? { id: hits[0].id, label: `@${hits[0].name}` } : { error: hits.length ? `Rolle „${name}“ gibt es mehrfach` : `Rolle „${name}“ nicht gefunden` };
  };

  for (const [key, entry] of Object.entries(data.settings)) {
    const def = SETTINGS.find(s => s.key === key);
    if (!def) { missing.push({ key, label: key, reason: "gibt es im Corleone-Bot nicht" }); continue; }
    if (SKIP_KEYS.has(key)) { missing.push({ key, label: def.label, reason: SKIP_KEYS.get(key) }); continue; }
    const add = (value, display) => changes.push({ key, label: def.label, value, display });
    if (["channel", "category", "forum"].includes(def.type)) {
      const hit = findChannel(entry?.channel, def.type);
      if (hit.id) add(hit.id, hit.label); else missing.push({ key, label: def.label, reason: hit.error });
    } else if (def.type === "channels") {
      const refs = Array.isArray(entry?.channels) ? entry.channels : [];
      const hits = refs.map(ref => findChannel(ref, "channel"));
      const found = hits.filter(h => h.id);
      hits.filter(h => h.error).forEach(h => missing.push({ key, label: def.label, reason: h.error }));
      if (found.length) add(found.map(h => h.id), found.map(h => h.label).join(", "));
    } else if (def.type === "roles") {
      // Erst der Originalname, sonst umbenannt (z. B. „| Nexus“ → „| Corleone“).
      const hits = (Array.isArray(entry?.roles) ? entry.roles : []).map(name => { const hit = findRole(name); return hit.id ? hit : findRole(renameFamily(name)).id ? findRole(renameFamily(name)) : hit; });
      const found = hits.filter(h => h.id);
      hits.filter(h => h.error).forEach(h => missing.push({ key, label: def.label, reason: h.error }));
      if (found.length) add(found.map(h => h.id), found.map(h => h.label).join(", "));
    } else if (def.type === "rankRoles") {
      const ranks = [];
      for (const rank of Array.isArray(entry?.ranks) ? entry.ranks : []) {
        const hit = rank?.role ? findRole(rank.role) : { error: "ohne Rolle" };
        if (hit.id) ranks.push({ label: String(rank.label ?? rank.role).slice(0, 80), roleId: hit.id });
        else missing.push({ key, label: def.label, reason: `${rank?.label ?? "Rang"}: ${hit.error}` });
      }
      if (ranks.length) add(ranks, ranks.map(r => r.label).join(", "));
    } else if (def.type === "ticketCategories") {
      // Zuständige Rollen stehen dort als Nexus-IDs – nur die Kategorien selbst übernehmen.
      const list = Array.isArray(entry?.value) ? entry.value : [];
      const cleaned = list.filter(c => c && c.id && c.label).map(c => ({ ...c, label: renameFamily(c.label), ...(c.description ? { description: renameFamily(c.description) } : {}), roleIds: [] }));
      if (cleaned.length) add(cleaned, cleaned.map(c => c.label).join(", "));
      if (list.some(c => Array.isArray(c?.roleIds) && c.roleIds.length)) missing.push({ key, label: def.label, reason: "zuständige Rollen je Kategorie bitte neu auswählen" });
    } else if (def.type === "money") {
      const cents = Number(entry?.value);
      if (Number.isSafeInteger(cents) && cents > 0) add((cents / 100).toFixed(2), `$${(cents / 100).toLocaleString("de-DE")}`);
    } else if (def.type === "text") {
      const value = renameFamily(entry?.value);
      add(value, value || "(leer)");
    } else if (entry && "value" in entry) {
      const value = entry.value;
      add(value, Array.isArray(value) ? value.join(", ") : typeof value === "object" && value !== null ? "(JSON)" : String(value));
    }
  }

  for (const [key, raw] of Object.entries(data.texts ?? {})) {
    const panel = panelForTextKey(key);
    if (!panel) continue;
    let values;
    try { values = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { continue; }
    if (!values || typeof values !== "object") continue;
    const fields = PANEL_TEXTS[panel].fields;
    // Farben bleiben beim Corleone-Design; Texte werden umbenannt.
    const cleaned = Object.fromEntries(Object.entries(values).filter(([field, v]) => fields[field] && fields[field].type !== "color" && typeof v === "string").map(([field, v]) => [field, renameFamily(v)]));
    if (Object.keys(cleaned).length) texts.push({ panel, label: PANEL_TEXTS[panel].label, values: cleaned });
  }
  return { source: String(data.source ?? "Nexus"), exportedAt: data.exportedAt ?? null, confirmWord: SETTINGS_CONFIRM_WORD, changes, missing, texts };
}

/** Speichert alle übernehmbaren Einstellungen und Texte einzeln (ein Fehler stoppt nicht den Rest). */
export function applySettingsImport({ resolved, settings, textsService, actorId, actorRoleIds = [], actorIsOwner = false }) {
  const applied = [], failed = [];
  for (const change of resolved.changes) {
    try { settings.update({ key: change.key, value: change.value, actorId, actorRoleIds, actorIsOwner }); applied.push(change.key); }
    catch (error) { failed.push({ label: change.label, error: error.message }); }
  }
  const textsApplied = [];
  for (const item of resolved.texts) {
    try { textsService.update({ panel: item.panel, values: item.values, actorId }); textsApplied.push(item.panel); }
    catch (error) { failed.push({ label: `Texte: ${item.label}`, error: error.message }); }
  }
  return { applied, textsApplied, failed };
}

/**
 * Ohne Einstellungs-Datei: Funktions-Channels anhand ihrer Namen erkennen (z. B. nach dem Server-Aufbau aus Nexus).
 * Namen werden ohne Emoji/Trennzeichen verglichen; „Staff“-Channels müssen in einer Staff-/Leitungs-Kategorie liegen,
 * öffentliche nicht. Übernommen werden nur eindeutige Treffer für noch leere Einstellungen – nichts wird überschrieben.
 */
const AUTO_RULES = {
  CHANNEL_WELCOME: { name: /^willkommen$/ },
  CHANNEL_VERIFICATION_PANEL: { name: /^(verifizier(en|ung)|neue-spieler)$/ },
  CHANNEL_ACCOUNT_PANEL: { name: /^(mein-)?(familien)?konto$/ },
  CHANNEL_WEBSITE_PANEL: { name: /^(dashboard|website)$/ },
  CHANNEL_TICKET_PANEL: { name: /^(tickets?|ticket-erstellen|support)$/, staff: false },
  CHANNEL_TICKET_CATEGORY: { name: /^(tickets?|support)$/, kind: "category" },
  CHANNEL_TICKET_CLOSED_CATEGORY: { name: /(closed|geschlossen)/, kind: "category" },
  CHANNEL_TICKET_LOG: { name: /^ticket-?logs?$/ },
  CHANNEL_APPLICATION_PANEL: { name: /^bewerbung(en)?$/, staff: false },
  CHANNEL_APPLICATION_REVIEW: { name: /^bewerbung(en)?(-prüfen)?$/, staff: true },
  CHANNEL_RANK_REVIEW: { name: /^rang-?antr(ä|ae)ge$/ },
  CHANNEL_EVENT_ANNOUNCEMENTS: { name: /^event-?ankündigungen$/ },
  CHANNEL_EVENT_SIGNUP: { name: /^event-?anmeld(en|ung)$/ },
  CHANNEL_ANNOUNCEMENTS: { name: /^ankündigungen$/ },
  CHANNEL_BOT_SUGGESTIONS: { name: /^bot-?vorschl(ä|ae)ge$/ },
  CHANNEL_POLLS: { name: /^abstimmung(en)?$/ },
  CHANNEL_SANCTION_LIST: { name: /^sanktionsliste$/ },
  CHANNEL_ABSENCES: { name: /^abmeldung(en)?$/ },
  CHANNEL_LEADERBOARD: { name: /^(rangliste|leaderboard)$/ },
  CHANNEL_ACTIVITY_BOARD: { name: /^(event-?infos|aktivitäten)$/ },
  CHANNEL_EVENT_RESULTS: { name: /^event-?ergebnisse$/ },
  CHANNEL_BOT_COMMANDS: { name: /^bot-?befehle$/ },
  CHANNEL_EVENT_CHECK: { name: /^event-?check$/ },
  CHANNEL_GIVEAWAYS: { name: /^giveaways?$/ },
  CHANNEL_STAFF_DASHBOARD: { name: /^staff-?dashboard$/ },
  CHANNEL_SANCTION_LOG: { name: /^sanktions?-?logs?$/ },
  CHANNEL_PAYOUT_LIST: { name: /^auszahlungsliste$/ },
  CHANNEL_TASK_REVIEW: { name: /^aufgaben-?pr(ü|ue)fung$/ },
  CHANNEL_TASK_BOARD: { name: /^aufgaben$/ },
  CHANNEL_TASK_FORUM: { name: /^aufgaben-?logs?$/, kind: "forum" },
  CHANNEL_EVENT_FORUM: { name: /^event-?logs?$/, kind: "forum" },
  CHANNEL_EVENT_LOG: { name: /^event-?logs?$/ },
  CHANNEL_FINANCE_LOG: { name: /^(auszahlungen|finanz-?logs?)$/, staff: true },
  CHANNEL_STATS: { name: /^(server-?)?statistik$/ },
  CHANNEL_AUDIT_LOG: { name: /^(bot-?logs?|audit-?logs?)$/ },
  CHANNEL_INVITE_TOURNAMENT: { name: /^invite-?turnier$/ },
};
const plainName = name => String(name ?? "").toLowerCase().normalize("NFC").replace(/^[^a-z0-9äöüß]+/u, "").replace(/[^a-z0-9äöüß-]+$/u, "").trim();
const isStaffCategory = name => /(staff|leitung|team|intern|admin|moderation|verwaltung)/.test(plainName(name));

export async function autoAssignChannels({ guild, config }) {
  const channels = [...(await guild.channels.fetch()).values()].filter(Boolean);
  const categoryName = new Map(channels.filter(isCategory).map(c => [c.id, c.name]));
  const changes = [], missing = [];
  for (const [key, rule] of Object.entries(AUTO_RULES)) {
    const def = SETTINGS.find(s => s.key === key);
    if (!def || config[key]) continue;
    const kind = rule.kind ?? "channel";
    let hits = channels.filter(c => (kind === "category" ? isCategory(c) : kind === "forum" ? isForum(c) : isTextLike(c) && c.type !== ChannelType.GuildVoice && c.type !== ChannelType.GuildStageVoice) && rule.name.test(plainName(c.name)));
    if (rule.staff !== undefined) hits = hits.filter(c => isStaffCategory(categoryName.get(c.parentId)) === rule.staff);
    if (hits.length === 1) changes.push({ key, label: def.label, value: hits[0].id, display: `${kind === "category" ? "📁 " : "#"}${hits[0].name}` });
    else if (hits.length > 1) missing.push({ key, label: def.label, reason: `mehrere passende Channels (${hits.slice(0, 3).map(c => `#${c.name}`).join(", ")}) – bitte selbst wählen` });
    else if (kind === "forum" && channels.some(c => rule.name.test(plainName(c.name)))) missing.push({ key, label: def.label, reason: "der Channel ist kein Forum (Forum gibt es nur mit aktiviertem Community-Modus)" });
  }
  return { source: "Channel-Namen", exportedAt: null, confirmWord: SETTINGS_CONFIRM_WORD, changes, missing, texts: [] };
}
