import { randomUUID } from "node:crypto";
import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { accessGroups } from "./config.js";
import { audit, getSetting, setSetting } from "./database.js";

/**
 * Bot-Vorschläge: Einfach in den Channel schreiben (oder Panel „Neue Idee / Verbesserung / Änderung“) → nummerierte Karte
 * „Vorschlag #12“ mit Dafür/Dagegen und eigenem Diskussions-Thread. Das Team (Staff/Leitung) setzt den Status; die Person
 * bekommt dazu eine DM.
 */
export const SUGGESTION_PANEL_KEY = "PANEL_BOT_SUGGESTIONS";
export const KINDS = { general: { emoji: "💡", label: "Vorschlag" }, idea: { emoji: "💡", label: "Neue Idee" }, improve: { emoji: "🔧", label: "Verbesserung" }, change: { emoji: "✏️", label: "Änderung" } };
export const STATUS = {
  open: { label: "🕓 Offen", color: 0xf2f2f2 },
  accepted: { label: "✅ Angenommen – kommt", color: 0x0a84ff },
  done: { label: "🛠️ Umgesetzt", color: 0x30d158 },
  rejected: { label: "❌ Abgelehnt", color: 0xff453a },
};
const DAILY_LIMIT = 5;
const unix = iso => Math.floor(new Date(iso).getTime() / 1000);

export function buildSuggestionPanelPayload() {
  const embed = new EmbedBuilder().setColor(0xf2f2f2).setAuthor({ name: "CORLEONE  •  BOT-VORSCHLÄGE" }).setTitle("💡 Wie können wir den Bot besser machen?")
    .setDescription("✍️ Schreib deinen Vorschlag einfach als Nachricht in diesen Channel");
  return { embeds: [embed], components: [] };
}

const votesOf = (db, id) => db.prepare("SELECT COALESCE(SUM(vote=1),0) up, COALESCE(SUM(vote=-1),0) down FROM suggestion_votes WHERE suggestion_id=?").get(id);

/** Laufende Nummer pro Server (ältere Einträge ohne Nummer bekommen sie nach Erstellzeit). */
function ensureNumbers(db) {
  db.prepare("UPDATE suggestions SET number=(SELECT COUNT(*) FROM suggestions s2 WHERE s2.guild_id=suggestions.guild_id AND (s2.created_at<suggestions.created_at OR (s2.created_at=suggestions.created_at AND s2.id<=suggestions.id))) WHERE number IS NULL").run();
}
const quote = text => String(text).split("\n").map(line => `> ${line}`).join("\n");

export function suggestionCard(db, row) {
  const k = KINDS[row.kind] ?? KINDS.general, s = STATUS[row.status] ?? STATUS.open, v = votesOf(db, row.id);
  // Vorschläge aus einer Nachricht: der Titel ist nur der Anfang des Textes – dann nur den Text zeigen (nicht doppelt).
  const ownTitle = row.text && !row.text.startsWith(row.title);
  const body = ownTitle ? `**${row.title}**\n${row.text}` : row.text || `**${row.title}**`;
  const embed = new EmbedBuilder().setColor(s.color).setTitle(`💡 Vorschlag #${row.number ?? "?"}`)
    .setDescription([
      `• 🏷️ **Kategorie:** ${k.emoji} ${k.label}`,
      `• 👤 **Ersteller:** <@${row.user_id}>`,
      `• 🟢 **Dafür:** ${v.up}`,
      `• 🔴 **Dagegen:** ${v.down}`,
      `• 📌 **Status:** ${s.label}`,
      "",
      "**Vorschlag**",
      quote(body).slice(0, 3000),
      ...(row.decided_by ? ["", `**${row.status === "rejected" ? "Begründung" : "Antwort vom Team"}** · <@${row.decided_by}> <t:${unix(row.decided_at)}:R>`, row.note ? quote(row.note).slice(0, 600) : "> —"] : []),
    ].join("\n"))
    .setFooter({ text: "CORLEONE  •  Bot-Vorschläge" }).setTimestamp(new Date(row.created_at));
  if (row.avatar_url) embed.setThumbnail(row.avatar_url);
  if (row.image_name) embed.setImage(`attachment://${row.image_name}`);
  const votes = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`sug:up:${row.id}`).setEmoji("🟢").setLabel("Dafür").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`sug:down:${row.id}`).setEmoji("🔴").setLabel("Dagegen").setStyle(ButtonStyle.Secondary));
  const team = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`sug:set:${row.id}:accepted`).setEmoji("✅").setLabel("Akzeptieren").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`sug:set:${row.id}:done`).setEmoji("🛠️").setLabel("Umgesetzt").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`sug:set:${row.id}:rejected`).setEmoji("❌").setLabel("Ablehnen").setStyle(ButtonStyle.Secondary));
  return { embeds: [embed], components: [votes, team], allowedMentions: { parse: [] } };
}

/** Neuen Vorschlag speichern und als Karte (mit Thread) posten; Panel rückt nach unten. */
async function createSuggestion({ db, config, channel, guildId, user, kind, title, text, image = null }) {
  ensureNumbers(db);
  const number = db.prepare("SELECT COALESCE(MAX(number),0)+1 n FROM suggestions WHERE guild_id=?").get(guildId).n;
  const row = { id: randomUUID(), guild_id: guildId, user_id: user.id, kind, title, text, status: "open", number, created_at: new Date().toISOString(),
    avatar_url: typeof user.displayAvatarURL === "function" ? user.displayAvatarURL({ size: 128, extension: "png" }) : null, image_name: image?.name ?? null };
  db.prepare("INSERT INTO suggestions(id,guild_id,user_id,kind,title,text,status,number,avatar_url,image_name,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(row.id, guildId, user.id, kind, title, text, "open", number, row.avatar_url, row.image_name, row.created_at);
  audit(db, guildId, user.id, "suggestion.created", row.id, { name: title, kind });
  const message = await channel.send({ ...suggestionCard(db, row), files: image ? [new AttachmentBuilder(image.buffer, { name: image.name })] : [] }).catch(() => null);
  if (message) {
    db.prepare("UPDATE suggestions SET channel_id=?,message_id=? WHERE id=?").run(channel.id, message.id, row.id);
    const name = user.globalName ?? user.username ?? "Mitglied";
    await message.startThread?.({ name: `Diskussion über den Vorschlag von ${name}`.slice(0, 100), autoArchiveDuration: 10080, reason: "Diskussion zum Vorschlag" }).catch(() => null);
    await bumpPanel({ db, config, channel });
  }
  return { row, message };
}

/** Bild aus der Nachricht übernehmen (die Originalnachricht wird gelöscht, ihr Link liefe sonst ins Leere). */
async function downloadImage(message) {
  const a = [...(message.attachments?.values?.() ?? [])].find(x => /^image\//.test(x.contentType ?? "") || /\.(png|jpe?g|webp|gif)(\?|$)/i.test(x.name ?? ""));
  if (!a || (a.size ?? 0) > 8 * 1024 * 1024) return null;
  try {
    const response = await fetch(a.url);
    if (!response.ok) return null;
    const ext = (/\.(png|jpe?g|webp|gif)(?:\?|$)/i.exec(a.name ?? "")?.[1] ?? "png").toLowerCase();
    return { buffer: Buffer.from(await response.arrayBuffer()), name: `vorschlag.${ext}` };
  } catch { return null; }
}

/**
 * Nachricht im Vorschlags-Channel: wird zum Vorschlag (Original verschwindet). Erste Zeile = Überschrift.
 * Gibt true zurück, wenn verarbeitet.
 */
export async function handleSuggestionMessage({ db, config, message }) {
  if (!config.CHANNEL_BOT_SUGGESTIONS || message.channelId !== config.CHANNEL_BOT_SUGGESTIONS || message.author?.bot || message.webhookId) return false;
  const raw = String(message.content ?? "").trim();
  const image = await downloadImage(message);
  const remove = () => message.delete().catch(() => {});
  const hint = async content => { const m = await message.channel.send({ content: `<@${message.author.id}> ${content}`, allowedMentions: { users: [message.author.id] } }).catch(() => null); if (m) setTimeout(() => m.delete().catch(() => {}), 10_000).unref?.(); };
  if (raw.length < 10 && !image) { await remove(); await hint("Bitte beschreib deinen Vorschlag etwas genauer (mindestens 10 Zeichen)."); return true; }
  const today = db.prepare("SELECT COUNT(*) n FROM suggestions WHERE guild_id=? AND user_id=? AND created_at>=?").get(message.guildId, message.author.id, new Date(Date.now() - 86_400_000).toISOString()).n;
  if (today >= DAILY_LIMIT) { await remove(); await hint(`Du hast heute schon ${DAILY_LIMIT} Vorschläge eingereicht – morgen gerne weitere. 🙂`); return true; }
  const [first, ...rest] = (raw || "Vorschlag mit Bild").split("\n");
  const title = first.trim().slice(0, 80) || "Vorschlag", text = (rest.join("\n").trim() || raw).slice(0, 1000);
  await remove();
  await createSuggestion({ db, config, channel: message.channel, guildId: message.guildId, user: message.author, kind: "general", title, text, image });
  return true;
}

const isTeam = (i, config) => (config.BOT_OWNER_IDS ?? []).includes(i.user.id) || accessGroups(config).staff.some(id => i.member?.roles?.cache?.has?.(id));
const byId = (db, id) => db.prepare("SELECT * FROM suggestions WHERE id=?").get(id);

/** Panel ans Ende des Channels holen (altes löschen, neu posten), damit es nach neuen Vorschlägen sichtbar bleibt. */
async function bumpPanel({ db, config, channel }) {
  const guildId = config.DISCORD_GUILD_ID;
  const [storedChannel, storedMessage] = String(getSetting(db, guildId, SUGGESTION_PANEL_KEY) ?? "").split(":");
  if (storedChannel !== channel.id) return;
  const old = storedMessage ? await channel.messages.fetch(storedMessage).catch(() => null) : null;
  const sent = await channel.send(buildSuggestionPanelPayload()).catch(() => null);
  if (!sent) return;
  setSetting(db, guildId, SUGGESTION_PANEL_KEY, `${channel.id}:${sent.id}`);
  await old?.delete?.().catch(() => {});
}

async function refreshCard({ db, client, row }) {
  const channel = row.channel_id ? await client.channels.fetch(row.channel_id).catch(() => null) : null;
  const message = row.message_id ? await channel?.messages?.fetch(row.message_id).catch(() => null) : null;
  await message?.edit(suggestionCard(db, row)).catch(() => {});
}

export async function handleSuggestionInteraction({ i, db, client, config }) {
  const [, action, id, extra] = i.customId.split(":");
  const reply = content => i.reply({ content, flags: MessageFlags.Ephemeral });
  if (action === "new") {
    const k = KINDS[id];
    if (!k) return reply("Unbekannte Art.");
    return i.showModal(new ModalBuilder().setCustomId(`sug:submit:${id}`).setTitle(`${k.emoji} ${k.label}`.slice(0, 45)).addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("title").setLabel("Kurz in einem Satz").setPlaceholder(id === "idea" ? "z. B. Geburtstags-Glückwünsche vom Bot" : "z. B. Event-Erinnerung schon 1 Std. vorher").setStyle(TextInputStyle.Short).setRequired(true).setMinLength(4).setMaxLength(80)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("text").setLabel("Beschreibung – was genau und warum?").setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(10).setMaxLength(1000))));
  }
  if (action === "submit") {
    const kind = KINDS[id] ? id : "idea";
    const today = db.prepare("SELECT COUNT(*) n FROM suggestions WHERE guild_id=? AND user_id=? AND created_at>=?").get(i.guildId, i.user.id, new Date(Date.now() - 86_400_000).toISOString()).n;
    if (today >= DAILY_LIMIT) return reply(`Du hast heute schon ${DAILY_LIMIT} Vorschläge eingereicht – morgen gerne weitere. 🙂`);
    const title = String(i.fields.getTextInputValue("title")).trim().slice(0, 80), text = String(i.fields.getTextInputValue("text")).trim().slice(0, 1000);
    const channel = (config.CHANNEL_BOT_SUGGESTIONS ? await client.channels.fetch(config.CHANNEL_BOT_SUGGESTIONS).catch(() => null) : null) ?? i.channel;
    if (!channel?.send) return reply("Der Vorschlags-Channel ist nicht erreichbar – bitte dem Team Bescheid geben.");
    const { message } = await createSuggestion({ db, config, channel, guildId: i.guildId, user: i.user, kind, title, text });
    return reply(`✅ Danke! Dein Vorschlag **${title}** ist eingereicht${message ? ` – ${message.url}` : ""}. Du bekommst eine DM, sobald das Team entschieden hat.`);
  }
  const row = byId(db, id);
  if (!row || row.guild_id !== i.guildId) return reply("Diesen Vorschlag gibt es nicht mehr.");
  if (action === "up" || action === "down") {
    const vote = action === "up" ? 1 : -1, current = db.prepare("SELECT vote FROM suggestion_votes WHERE suggestion_id=? AND user_id=?").get(row.id, i.user.id)?.vote;
    if (current === vote) db.prepare("DELETE FROM suggestion_votes WHERE suggestion_id=? AND user_id=?").run(row.id, i.user.id);
    else db.prepare("INSERT INTO suggestion_votes(suggestion_id,user_id,vote,voted_at) VALUES(?,?,?,?) ON CONFLICT(suggestion_id,user_id) DO UPDATE SET vote=excluded.vote,voted_at=excluded.voted_at").run(row.id, i.user.id, vote, new Date().toISOString());
    return i.update(suggestionCard(db, row));
  }
  if (action === "set" || action === "setnote") {
    if (!isTeam(i, config)) return reply("Den Status setzt nur das Team (Staff/Leitung). Abstimmen kannst du mit 👍 / 👎.");
    const status = STATUS[extra] ? extra : null;
    if (!status) return reply("Unbekannter Status.");
    if (action === "set") return i.showModal(new ModalBuilder().setCustomId(`sug:setnote:${row.id}:${status}`).setTitle(STATUS[status].label.slice(0, 45)).addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("note").setLabel(status === "rejected" ? "Begründung (bekommt die Person per DM)" : "Notiz (optional, z. B. wann es kommt)").setStyle(TextInputStyle.Paragraph).setRequired(status === "rejected").setMaxLength(500).setValue(row.note ?? ""))));
    await setSuggestionStatus({ db, client: i.client ?? client, row, status, note: i.fields.getTextInputValue("note"), actorId: i.user.id });
    return reply(`Status gesetzt: ${STATUS[status].label}.`);
  }
  return reply("Unbekannte Aktion.");
}

/** Status setzen (Discord oder Website): speichern, Karte aktualisieren, DM an die Person. */
export async function setSuggestionStatus({ db, client, row, status, note, actorId }) {
  const text = String(note ?? "").trim().slice(0, 500) || null;
  db.prepare("UPDATE suggestions SET status=?,note=?,decided_by=?,decided_at=? WHERE id=?").run(status, text, actorId, new Date().toISOString(), row.id);
  audit(db, row.guild_id, actorId, "suggestion.status", row.id, { name: row.title, value: status });
  await refreshCard({ db, client, row: byId(db, row.id) });
  await client.users.fetch(row.user_id).then(user => user.send({ embeds: [new EmbedBuilder().setColor(STATUS[status].color).setAuthor({ name: "CORLEONE  •  BOT-VORSCHLÄGE" })
    .setTitle(`${STATUS[status].label}: ${row.title}`.slice(0, 256)).setDescription(`${text ? `${text}\n\n` : ""}Danke für deinen Vorschlag!`).setTimestamp()] })).catch(() => {});
  return byId(db, row.id);
}

/** Liste für die Website (mit Stimmen). */
export function listSuggestions(db, guildId, { status = null, limit = 200 } = {}) {
  ensureNumbers(db);
  return db.prepare(`SELECT s.*, COALESCE((SELECT SUM(vote=1) FROM suggestion_votes v WHERE v.suggestion_id=s.id),0) up, COALESCE((SELECT SUM(vote=-1) FROM suggestion_votes v WHERE v.suggestion_id=s.id),0) down
    FROM suggestions s WHERE s.guild_id=? ${status ? "AND s.status=?" : ""} ORDER BY s.number DESC LIMIT ?`).all(...(status ? [guildId, status, limit] : [guildId, limit]));
}
export { byId as suggestionById };

/** Vorschlag komplett entfernen: Karte und Diskussions-Thread in Discord, Stimmen und Eintrag. */
export async function deleteSuggestion({ db, client, row, actorId }) {
  const channel = row.channel_id ? await client.channels.fetch(row.channel_id).catch(() => null) : null;
  if (row.message_id) {
    const thread = await client.channels.fetch(row.message_id).catch(() => null); // Thread-ID = ID der Karte
    await thread?.delete?.("Vorschlag gelöscht").catch(() => {});
    const message = await channel?.messages?.fetch(row.message_id).catch(() => null);
    await message?.delete?.().catch(() => {});
  }
  db.prepare("DELETE FROM suggestion_votes WHERE suggestion_id=?").run(row.id);
  db.prepare("DELETE FROM suggestions WHERE id=?").run(row.id);
  audit(db, row.guild_id, actorId, "suggestion.deleted", row.id, { name: row.title, number: row.number });
}
