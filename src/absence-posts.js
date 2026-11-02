import { createHash } from "node:crypto";
import { EmbedBuilder } from "discord.js";
import { BRAND_COLOR } from "./presentation.js";
import { getSetting, setSetting } from "./database.js";
import { formatDay, localDay } from "./services/absences.js";

export const ABSENCE_LIST_KEY = "ABSENCE_LIST_MESSAGE";
const LIST_FOOTER = "YAMAMOTO  •  Abmeldungsliste";
const shortClock = (iso, timezone) => new Intl.DateTimeFormat("de-AT", { hour: "2-digit", minute: "2-digit", timeZone: timezone }).format(new Date(iso));
const snowflakeAfter = (a, b) => BigInt(a) > BigInt(b);

/** Ein Embed unter dem Panel mit allen laufenden, kurzen und geplanten Abmeldungen. */
export function buildAbsenceList({ db, config, reference = new Date() }) {
  const guildId = config.DISCORD_GUILD_ID, today = localDay(reference, config.TIMEZONE), now = reference.toISOString();
  const reason = row => config.ABSENCE_SHOW_REASON && row.reason ? ` – ${row.reason}` : "";
  const current = db.prepare("SELECT * FROM member_absences WHERE guild_id=? AND ended_at IS NULL AND starts_on<=? AND ends_on>=? ORDER BY ends_on, user_id").all(guildId, today, today);
  const planned = db.prepare("SELECT * FROM member_absences WHERE guild_id=? AND ended_at IS NULL AND starts_on>? ORDER BY starts_on, user_id LIMIT 50").all(guildId, today);
  const short = db.prepare("SELECT * FROM short_absences WHERE guild_id=? AND ended_at IS NULL AND starts_at<=? AND ends_at>? ORDER BY ends_at").all(guildId, now, now);
  const section = (title, lines) => lines.length ? `**${title}**\n${lines.join("\n")}` : null;
  const parts = [
    section(`🚫 Abgemeldet (${current.length})`, current.map(r => `<@${r.user_id}> bis **${formatDay(r.ends_on)}**${reason(r)}`)),
    section(`⏱️ Kurz weg (${short.length})`, short.map(r => `<@${r.user_id}> bis **${shortClock(r.ends_at, config.TIMEZONE)}** (<t:${Math.floor(new Date(r.ends_at).getTime() / 1000)}:R>)${reason(r)}`)),
    section(`🗓️ Geplant (${planned.length})`, planned.map(r => `<@${r.user_id}> **${formatDay(r.starts_on)} – ${formatDay(r.ends_on)}**${reason(r)}`)),
  ].filter(Boolean);
  let description = parts.join("\n\n") || "✅ Gerade ist niemand abgemeldet.";
  if (description.length > 4000) description = `${description.slice(0, 3990)}\n…`;
  const embed = new EmbedBuilder().setColor(BRAND_COLOR).setTitle("📋 Aktuelle Abmeldungen").setDescription(description).setFooter({ text: LIST_FOOTER });
  return { embeds: [embed], allowedMentions: { parse: [] } };
}

/**
 * Hält die Abmeldungsliste aktuell. Bearbeitet wird nur bei Änderungen; liegt die Liste nicht mehr unter dem Panel
 * (Panel neu gepostet) oder wurde sie gelöscht, wird sie neu gepostet.
 */
export async function updateAbsenceList({ db, client, config, reference = new Date(), force = false }) {
  const guildId = config.DISCORD_GUILD_ID;
  if (!guildId || !config.CHANNEL_ABSENCES) return false;
  const channel = await client.channels.fetch(config.CHANNEL_ABSENCES).catch(() => null);
  if (!channel?.send) return false;
  const payload = buildAbsenceList({ db, config, reference });
  const signature = createHash("sha1").update(JSON.stringify((({ author, title, description, footer }) => [author, title, description, footer])(payload.embeds[0].toJSON()))).digest("hex").slice(0, 16);
  const [storedChannel, storedMessage, storedSignature] = (getSetting(db, guildId, ABSENCE_LIST_KEY) ?? "").split("|");
  const panelId = (getSetting(db, guildId, "PANEL_ABSENCE") ?? "").split(":")[1];
  let message = null, gone = false;
  if (storedChannel === channel.id && storedMessage) message = await channel.messages.fetch(storedMessage).catch(error => { gone = error?.code === 10008; return null; });
  if (storedChannel === channel.id && storedMessage && !message && !gone) return false; // Discord gerade nicht erreichbar
  if (message && panelId && !snowflakeAfter(message.id, panelId)) { await message.delete().catch(() => {}); message = null; }
  if (message) {
    if (!force && storedSignature === signature) return true;
    const ok = await message.edit(payload).then(() => true).catch(() => false);
    if (ok) setSetting(db, guildId, ABSENCE_LIST_KEY, `${channel.id}|${message.id}|${signature}`);
    return ok;
  }
  const sent = await channel.send(payload).catch(() => null);
  if (sent) setSetting(db, guildId, ABSENCE_LIST_KEY, `${channel.id}|${sent.id}|${signature}`);
  return Boolean(sent);
}

/** Abmeldung eingetragen: Liste aktualisieren. */
export const postAbsence = ({ db, client, config }) => updateAbsenceList({ db, client, config });

/** Abmeldung beendet: alte Einzelmeldung (falls noch vorhanden) löschen und Liste aktualisieren. */
export async function removeAbsencePost({ db, client, config, row }) {
  const current = row && db.prepare("SELECT id, channel_id, message_id FROM member_absences WHERE id=?").get(row.id);
  if (current?.message_id) {
    const channel = await client.channels.fetch(current.channel_id).catch(() => null);
    const message = await channel?.messages?.fetch(current.message_id).catch(() => null);
    await message?.delete?.().catch(() => {});
    db.prepare("UPDATE member_absences SET channel_id=NULL, message_id=NULL WHERE id=?").run(current.id);
  }
  return config ? updateAbsenceList({ db, client, config }) : true;
}

/**
 * Vergibt ROLE_ABSENT, solange eine Abmeldung läuft, und entfernt sie danach. role_applied merkt sich, wo der Bot
 * die Rolle gesetzt hat; manuell vergebene Rollen ohne Abmeldung bleiben unangetastet.
 */
export async function syncAbsenceRoles({ db, client, config, reference = new Date() }) {
  const guildId = config.DISCORD_GUILD_ID, roles = config.ROLE_ABSENT ?? [];
  if (!guildId || !roles.length) return { added: 0, removed: 0 };
  const today = localDay(reference, config.TIMEZONE);
  const guild = client.guilds.cache.get(guildId) ?? await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return { added: 0, removed: 0 };
  let added = 0, removed = 0;
  const start = db.prepare("SELECT * FROM member_absences WHERE guild_id=? AND ended_at IS NULL AND role_applied=0 AND starts_on<=? AND ends_on>=?").all(guildId, today, today);
  for (const row of start) {
    const member = await guild.members.fetch(row.user_id).catch(() => null);
    if (member) for (const roleId of roles) if (!member.roles.cache.has(roleId)) await member.roles.add(roleId, "Yamamoto: Abmeldung").then(() => { added++; }).catch(error => console.warn("Abmelde-Rolle nicht vergeben:", error.message));
    db.prepare("UPDATE member_absences SET role_applied=1 WHERE id=?").run(row.id);
  }
  const stop = db.prepare("SELECT * FROM member_absences WHERE guild_id=? AND role_applied=1 AND (ended_at IS NOT NULL OR ends_on<? OR starts_on>?)").all(guildId, today, today);
  for (const row of stop) {
    const stillAbsent = db.prepare("SELECT 1 FROM member_absences WHERE guild_id=? AND user_id=? AND id<>? AND ended_at IS NULL AND starts_on<=? AND ends_on>=?").get(guildId, row.user_id, row.id, today, today);
    if (!stillAbsent) {
      const member = await guild.members.fetch(row.user_id).catch(() => null);
      if (member) for (const roleId of roles) if (member.roles.cache.has(roleId)) await member.roles.remove(roleId, "Yamamoto: Abmeldung beendet").then(() => { removed++; }).catch(error => console.warn("Abmelde-Rolle nicht entfernt:", error.message));
    }
    db.prepare("UPDATE member_absences SET role_applied=0 WHERE id=?").run(row.id);
  }
  return { added, removed };
}

/** „Kurz weg“ eingetragen: steht ebenfalls in der Abmeldungsliste. */
export const postShortAbsence = ({ db, client, config }) => updateAbsenceList({ db, client, config });

/** Meldungen beendeter oder abgelaufener „Kurz weg“-Einträge entfernen (hält den Channel sauber). */
export async function cleanupShortAbsencePosts({ client, config, service, reference = new Date() }) {
  let removed = 0;
  for (const row of service.withStaleMessage(config.DISCORD_GUILD_ID, reference)) {
    const channel = await client.channels.fetch(row.channel_id).catch(() => null);
    const message = await channel?.messages?.fetch(row.message_id).catch(() => null);
    await message?.delete?.().catch(() => {});
    service.clearMessage(row.id);
    removed++;
  }
  return removed;
}
