import { audit } from "./database.js";
import { accessGroups } from "./config.js";
import { logEmbed } from "./presentation.js";
import { refreshEventPosts } from "./event-posts.js";
const unix = iso => Math.floor(new Date(iso).getTime() / 1000);
const fetchChannel = (client, id) => (id ? client.channels?.fetch?.(id).catch(() => null) : null);
const activeParticipants = (db, eventId) => db.prepare("SELECT user_id FROM event_participants WHERE event_id=? AND status IN ('signed_up','present') ORDER BY updated_at").all(eventId).map(r => r.user_id);

// ---------------------------------------------------------------- Mindestteilnehmer
export const minimumFor = (event, config) => event.min_participants ?? (config.EVENT_MIN_PARTICIPANTS > 0 ? config.EVENT_MIN_PARTICIPANTS : null);

/** Sagt ein Event ab, aktualisiert die Posts und informiert die Angemeldeten im Event-Channel. */
export async function cancelEvent({ db, client, config, eventId, actorId, reason }) {
  const row = db.transaction(() => {
    const changed = db.prepare("UPDATE events SET status='cancelled' WHERE id=? AND status='scheduled' RETURNING *").get(eventId);
    if (changed) audit(db, changed.guild_id, actorId, "event.cancelled", eventId, { name: changed.name, reason });
    return changed;
  })();
  if (!row) return null;
  await refreshEventPosts({ db, client, config, event: row, state: "cancelled" }).catch(() => {});
  const participants = activeParticipants(db, eventId).slice(0, 50);
  const embed = logEmbed("❌ Event abgesagt", `**${row.name}** am <t:${unix(row.starts_at)}:F> findet nicht statt.${reason ? `\n**Grund:** ${reason}` : ""}`, "warning");
  const pings = participants;
  const channel = await fetchChannel(client, row.channel_id);
  if (pings.length && channel?.send && !(row.series_id && config.EVENT_SERIES_DELETE_ENDED)) await channel.send({ content: pings.map(id => `<@${id}>`).join(" "), embeds: [embed], allowedMentions: { users: pings } }).catch(() => {});
  return row;
}

/** Prüft einmal pro Event kurz vor Start, ob genug angemeldet sind. */
export async function checkEventMinimums({ db, client, config, reference = new Date() }) {
  const until = new Date(reference.getTime() + config.EVENT_MIN_CHECK_MINUTES * 60_000).toISOString();
  const due = db.prepare("SELECT * FROM events WHERE status='scheduled' AND min_checked_at IS NULL AND starts_at<=? AND starts_at>?").all(until, reference.toISOString());
  const results = [];
  for (const event of due) {
    const minimum = minimumFor(event, config);
    // Reservieren, damit die Prüfung auch bei parallelen Durchläufen genau einmal passiert.
    if (!db.prepare("UPDATE events SET min_checked_at=? WHERE id=? AND min_checked_at IS NULL").run(reference.toISOString(), event.id).changes || !minimum) continue;
    const count = activeParticipants(db, event.id).length;
    if (count >= minimum) continue;
    audit(db, event.guild_id, client.user?.id ?? "system", "event.min_not_reached", event.id, { name: event.name, entries: count, value: minimum });
    if (config.EVENT_MIN_AUTO_CANCEL) {
      await cancelEvent({ db, client, config, eventId: event.id, actorId: client.user?.id ?? "system", reason: `Zu wenige Anmeldungen (${count} von mindestens ${minimum})` });
      results.push({ eventId: event.id, action: "cancelled", count, minimum });
    } else {
      const channel = await fetchChannel(client, config.CHANNEL_EVENT_LOG || config.CHANNEL_AUDIT_LOG);
      const team = accessGroups(config).events;
      await channel?.send?.({ content: team.map(id => `<@&${id}>`).join(" ") || undefined, allowedMentions: { roles: team },
        embeds: [logEmbed("⚠️ Zu wenige Anmeldungen", `**${event.name}** beginnt <t:${unix(event.starts_at)}:R>.\nAngemeldet: **${count}** · benötigt: **${minimum}**\n\nBitte entscheiden, ob das Event stattfindet – absagen über die Website oder \`/event absagen\`.`, "warning")] }).catch(() => {});
      results.push({ eventId: event.id, action: "alerted", count, minimum });
    }
  }
  return results;
}


