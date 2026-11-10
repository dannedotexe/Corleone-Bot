import { createHash } from "node:crypto";
import { EmbedBuilder } from "discord.js";
import { getSetting, setSetting } from "./database.js";
import { BRAND_COLOR } from "./presentation.js";
import { zonedTime } from "./services/event-series.js";

/**
 * Invite-Turnier: +1 Punkt je bestätigtem Invite-Log, −1 je über „−1 Ablehnen“ abgelehntem Invite-Log.
 * Während des Turniers haben Invite-Logs nur die Knöpfe „+1 Annehmen“ und „−1 Ablehnen“; danach wieder die normalen.
 * Gezählt wird nach Einreichungstag (Start bis Ende inklusive, Server-Zeitzone). Eine Nachricht in
 * CHANNEL_INVITE_TOURNAMENT, die der Bot bei Änderungen bearbeitet.
 */
const MESSAGE_KEY = "INVITE_TOURNAMENT_MESSAGE", HASH_KEY = "INVITE_TOURNAMENT_HASH";
// Ältere −1-Ablehnungen trugen „High-ID“ im Grund.
export const MINUS_REASON = "−1 im Invite-Turnier";
const MINUS = /invite-turnier|high[\s-]?id/i;

export function tournamentWindow(config) {
  const day = (text, endOfDay) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text ?? "");
    if (!m) return null;
    const start = zonedTime(Number(m[1]), Number(m[2]), Number(m[3]), 0, 0, config.TIMEZONE);
    return start && (endOfDay ? new Date(start.getTime() + 86_400_000) : start);
  };
  const from = day(config.INVITE_TOURNAMENT_START, false), to = day(config.INVITE_TOURNAMENT_END, true);
  return from && to && from < to ? { from, to } : null;
}

export function tournamentStandings(db, guildId, window) {
  const logs = db.prepare(`SELECT l.user_id,l.status,l.reject_reason FROM task_logs l JOIN task_types t ON t.id=l.type_id
    WHERE l.guild_id=? AND l.created_at>=? AND l.created_at<? AND l.status IN ('approved','rejected')
      AND (t.invite_min_days IS NOT NULL OR t.invite_min_events IS NOT NULL OR lower(t.name) LIKE '%invite%')`).all(guildId, window.from.toISOString(), window.to.toISOString());
  const byUser = new Map();
  for (const log of logs) {
    const plus = log.status === "approved" ? 1 : 0, minus = log.status === "rejected" && MINUS.test(log.reject_reason ?? "") ? 1 : 0;
    if (!plus && !minus) continue;
    const row = byUser.get(log.user_id) ?? { userId: log.user_id, plus: 0, minus: 0 };
    row.plus += plus; row.minus += minus; byUser.set(log.user_id, row);
  }
  return [...byUser.values()].map(r => ({ ...r, points: r.plus - r.minus })).sort((a, b) => b.points - a.points || b.plus - a.plus);
}

const MEDALS = ["🥇", "🥈", "🥉"];
export function buildTournamentBoard(db, guildId, config, reference = new Date()) {
  const window = tournamentWindow(config);
  if (!window) return null;
  const rows = tournamentStandings(db, guildId, window);
  const ended = reference >= window.to, unix = d => Math.floor(d.getTime() / 1000);
  const lines = rows.slice(0, 40).map((r, n) => `${MEDALS[n] ?? `**${n + 1}.**`} <@${r.userId}> · **${r.points} ${Math.abs(r.points) === 1 ? "Punkt" : "Punkte"}**${r.minus ? ` (+${r.plus} / −${r.minus})` : ""}`);
  const embed = new EmbedBuilder().setColor(BRAND_COLOR).setAuthor({ name: "CORLEONE  •  INVITE-TURNIER" })
    .setTitle(ended ? "🏆 Endstand" : "🏆 Rangliste")
    .setDescription([
      ended ? `Das Turnier ist vorbei (bis <t:${unix(window.to) - 1}:D>).` : `Läuft bis <t:${unix(window.to) - 1}:D> · endet <t:${unix(window.to)}:R>`,
      "✅ Angenommener Invite +1 · ❌ Abgelehnter Invite −1",
      "",
      lines.length ? lines.join("\n") : "Noch keine Punkte – der erste bestätigte Invite bringt dich nach oben!",
    ].join("\n").slice(0, 4096))
    .setFooter({ text: "Aktualisiert sich automatisch, sobald Invite-Logs angenommen oder abgelehnt werden" }).setTimestamp(reference);
  return { embeds: [embed], allowedMentions: { parse: [] } };
}

export async function refreshTournamentBoard({ db, client, config, reference = new Date() }) {
  const guildId = config.DISCORD_GUILD_ID;
  if (!guildId || !config.CHANNEL_INVITE_TOURNAMENT) return false;
  const payload = buildTournamentBoard(db, guildId, config, reference);
  if (!payload) return false;
  const data = payload.embeds[0].data;
  // Ohne Zeitstempel hashen, sonst würde jede Minute bearbeitet.
  const hash = createHash("sha256").update(JSON.stringify([data.title, data.description, config.CHANNEL_INVITE_TOURNAMENT])).digest("hex");
  if (getSetting(db, guildId, HASH_KEY) === hash) return false;
  const channel = await client.channels.fetch(config.CHANNEL_INVITE_TOURNAMENT).catch(() => null);
  if (!channel?.send) return false;
  const [storedChannel, storedMessage] = String(getSetting(db, guildId, MESSAGE_KEY) ?? "").split(":");
  const existing = storedChannel === channel.id && storedMessage ? await channel.messages?.fetch(storedMessage).catch(() => null) : null;
  if (existing) await existing.edit(payload);
  else { const message = await channel.send(payload); setSetting(db, guildId, MESSAGE_KEY, `${channel.id}:${message.id}`); }
  setSetting(db, guildId, HASH_KEY, hash);
  return true;
}

const isInviteLog = log => log?.invite_min_days != null || log?.invite_min_events != null || /invite/i.test(log?.type_name ?? "");

/** Läuft das Turnier gerade? (Rangliste eingestellt und heute zwischen Start und Ende.) */
export function tournamentActive(config, reference = new Date()) {
  const window = config?.CHANNEL_INVITE_TOURNAMENT ? tournamentWindow(config) : null;
  return Boolean(window && reference >= window.from && reference < window.to);
}

/** Turnier-Knöpfe („+1 Annehmen“ / „−1 Ablehnen“) statt der normalen – nur bei Invite-Logs während des Turniers. */
export const tournamentButtons = (config, log, reference = new Date()) => isInviteLog(log) && tournamentActive(config, reference);
